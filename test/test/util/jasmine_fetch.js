/**
 * @license
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


jasmine.Fetch = {};


/**
 * Contains information on requests made.
 */
jasmine.Fetch.requests = {};


// TODO: this only contains the methods that we use; if this is published
// it should contain the entire breadth of options in jasmine-ajax.


/**
 * Install a Jasmine-based mock for the fetch API.
 * This API is based on that of jasmine-ajax.
 */
jasmine.Fetch.install = function() {
  if (jasmine.Fetch.container_ && jasmine.Fetch.container_.installed_) {
    // jasmine.Fetch is already installed
    return;
  }

  // Set up the container.
  jasmine.Fetch.container_ = jasmine.Fetch.container_ || {};
  jasmine.Fetch.container_.installed_ = true;
  jasmine.Fetch.container_.stubbedRequests = {};
  /** @type {jasmine.Fetch.RequestStub} */
  jasmine.Fetch.container_.lastFetchRequestStub;
  jasmine.Fetch.container_.oldFetch = window.fetch;
  jasmine.Fetch.container_.oldHeaders = window.Headers;
  jasmine.Fetch.container_.oldAbortController = window.AbortController;

  window.Headers = /** @type {function (new:Headers,
        (Array<Array<string>>|Headers|IObject<string,string>)=)} */(
      jasmine.Fetch.Headers);

  window.AbortController = /** @type {function (new:AbortController)} */
      (jasmine.Fetch.AbortController);

  window.fetch = function(input, init) {
    // TODO: this does not support input in Request form
    var url = /** @type {string} */ (input);
    return jasmine.Fetch.impl_(url, init || null);
  };
};


/**
 * @return {!Error}
 * @private
 */
jasmine.Fetch.makeAbortError_ = function() {
  // As per the spec, this should be a DOMException, but
  // there is not a public constructor for this
  var exception = new Error('The operation was aborted. ');
  exception.name = 'AbortError';
  exception.code = 20;
  return exception;
};


/**
 * @param {string} url
 * @param {RequestInit} init
 * @return {!Promise.<!Response>}
 * @private
 */
jasmine.Fetch.impl_ = function(url, init) {
  if (init['signal'] && init['signal']()) {
    // Throw an exception.
    return Promise.reject(jasmine.Fetch.makeAbortError_());
  }

  var headers = {};
  var initHeaders = new jasmine.Fetch.Headers(init.headers);
  initHeaders.forEach(function(value, key) {
    headers[key] = value;
  });

  var newStub = /** @type {jasmine.Fetch.RequestStub} */({
    url: url,
    query: null,
    data: null,
    body: init.body,
    method: init.method,
    requestHeaders: headers,
    withCredentials: init.credentials == 'include',
    aborted: false
  });
  jasmine.Fetch.container_.lastFetchRequestStub = newStub;

  var stubbed = jasmine.Fetch.container_.stubbedRequests[url];
  if (stubbed.callFunc) {
    var callFunc = stubbed.callFunc;
    stubbed.callFunc = undefined;
    callFunc(stubbed, self);
    // Call fetch again, in case callFunc changed the stub's action.
    return jasmine.Fetch.impl_(url, init);
  } else if (stubbed.response) {
    var responseHeaders = new jasmine.Fetch.Headers();
    for (var key in stubbed.response.responseHeaders) {
      responseHeaders.append(key, stubbed.response.responseHeaders[key]);
    }

    // This creates an anonymous object instead of using the
    // built-in response constructor, because the fetch API
    // does not include a very good constructor for Response.
    var response = /** @type {!Response} */ ({
      status: stubbed.response.status,
      headers: responseHeaders,
      url: stubbed.response.responseURL || url,
      arrayBuffer: function() {
        return Promise.resolve(stubbed.response.response);
      }
    });
    return Promise.resolve(response);
  } else if (stubbed.error) {
    return Promise.reject('fake error');
  } else if (stubbed.timeout) {
    // Fetch does not time out yet, so just return a promise that rejects when
    // the user aborts.
    return new Promise(function(resolve, reject) {
      var interval = setInterval(function() {
        if (init['signal'] && init['signal']()) {
          // TODO: This assumes that this request is still the most recent.
          // If you have multiple requests at once, this could be incorrect.
          jasmine.Fetch.container_.lastFetchRequestStub.aborted = true;
          clearInterval(interval);
          reject(jasmine.Fetch.makeAbortError_());
        }
      }, 200);
    });
  }
  throw new Error('no known action');
};


/**
 * Uninstalls jasmine-fetch.
 */
jasmine.Fetch.uninstall = function() {
  if (jasmine.Fetch.container_ && jasmine.Fetch.container_.installed_) {
    window.fetch = jasmine.Fetch.container_.oldFetch;
    window.Headers = jasmine.Fetch.container_.oldHeaders;
    window.AbortController = jasmine.Fetch.container_.oldAbortController;
    jasmine.Fetch.container_.installed_ = false;
  }
};



/**
 * @constructor
 * @struct
 */
jasmine.Fetch.AbortController = function() {
  // TODO: I don't know if this implementation of AbortController is correct,
  // but it works for our tests
  this.aborted_ = false;
  this.signal = (function() { return this.aborted_; }).bind(this);
};


/**
 * Aborts any request that has been supplied the AbortController's signal.
 */
jasmine.Fetch.AbortController.prototype.abort = function() {
  this.aborted_ = true;
};



/**
 * @param {(Array<Array<string>>|Headers|IObject<string,string>)=} opt_headers
 *
 * @constructor
 * @struct
 */
jasmine.Fetch.Headers = function(opt_headers) {
  this.contents = {};

  if (opt_headers) {
    var headers = opt_headers;
    if (headers instanceof jasmine.Fetch.Headers) {
      // Extract contents, to be read as a generic object below.
      headers = headers.contents;
    }
    if (Array.isArray(headers)) {
      headers.forEach(function(header) {
        this.append(header[0], header[1]);
      }.bind(this));
    } else {
      Object.getOwnPropertyNames(headers).forEach(function(name) {
        this.append(name, headers[name]);
      }.bind(this));
    }
  }
};


/**
 * @param {string} name
 * @param {string} value
 */
jasmine.Fetch.Headers.prototype.append = function(name, value) {
  // Normalize name before setting.
  var normalized = name.toLowerCase();
  this.contents[normalized] = value;
};


/**
 * @param {Function} apply
 */
jasmine.Fetch.Headers.prototype.forEach = function(apply) {
  var contentsNames = Object.getOwnPropertyNames(this.contents);
  for (var i = 0; i < contentsNames.length; i++) {
    var contentsName = contentsNames[i];
    apply(this.get(contentsName), contentsName, this);
  }
};


/**
 * @return {Object}
 */
jasmine.Fetch.Headers.prototype.keys = function() {
  var contentsNames = Object.getOwnPropertyNames(this.contents);
  var index = 0;
  return {
    next: function() {
      return index < contentsNames.length ?
          {value: contentsNames[index++], done: false} :
          {done: true};
    }
  };
};


/**
 * @param {string} header
 * @return {string} value
 */
jasmine.Fetch.Headers.prototype.get = function(header) {
  return this.contents[header];
};


// TODO: add missing Headers methods: delete, entries, set, values
// see https://developer.mozilla.org/en-US/docs/Web/API/Headers
// also, make it conform to the iterable protocol


/**
 * @param {string} url
 * @return {jasmine.Fetch.RequestStub}
 */
jasmine.Fetch.stubRequest = function(url) {
  var stub = new jasmine.Fetch.RequestStub(url);
  jasmine.Fetch.container_.stubbedRequests[url] = stub;
  return stub;
};


/**
 * @return {jasmine.Fetch.RequestStub} request
 */
jasmine.Fetch.requests.mostRecent = function() {
  return jasmine.Fetch.container_.lastFetchRequestStub;
};



/**
 * @param {string} url
 *
 * @constructor
 * @struct
 */
jasmine.Fetch.RequestStub = function(url) {
  /** @type {string} */
  this.url = url;
  this.response = undefined;
  this.callFunc = undefined;
  this.timeout = false;
  this.error = false;

  /** @type {ArrayBuffer|undefined} */
  this.body = undefined;
  /** @type {?string} */
  this.query = null;
  /** @type {?Object} */
  this.data = null;
  /** @type {?string} */
  this.method = null;
  /** @type {Object} */
  this.requestHeaders = {};
  /** @type {boolean} */
  this.withCredentials = false;
  /** @type {boolean} */
  this.aborted = false;
};


/**
 * @param {Object} response
 * @return {jasmine.Fetch.RequestStub}
 */
jasmine.Fetch.RequestStub.prototype.andReturn = function(response) {
  this.response = response;
  this.callFunc = undefined;
  this.timeout = false;
  this.error = false;
  return this;
};


/**
 * @param {Function} callFunc
 * @return {jasmine.Fetch.RequestStub}
 */
jasmine.Fetch.RequestStub.prototype.andCallFunction = function(callFunc) {
  this.response = undefined;
  this.callFunc = callFunc;
  this.timeout = false;
  this.error = false;
  return this;
};


/**
 * @return {jasmine.Fetch.RequestStub}
 */
jasmine.Fetch.RequestStub.prototype.andTimeout = function() {
  this.response = undefined;
  this.callFunc = undefined;
  this.timeout = true;
  this.error = false;
  return this;
};


/**
 * @return {jasmine.Fetch.RequestStub}
 */
jasmine.Fetch.RequestStub.prototype.andError = function() {
  this.response = undefined;
  this.callFunc = undefined;
  this.timeout = false;
  this.error = true;
  return this;
};