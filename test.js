'use strict';

var assert = require('assert');
var fs = require('fs');
var googleAuthLibrary = require('google-auth-library');
var mockery = require('mockery');
var path = require('path');

var createSignOverride;
var fakeCrypto = {
  createSign: function () {
    return (createSignOverride || function () {}).apply(null, arguments);
  }
};

var googleAuthLibraryOverride;
function fakeGoogleAuthLibrary() {
  return (googleAuthLibraryOverride || googleAuthLibrary)
    .apply(null, arguments);
}

var requestOverride;
function fakeRequest() {
  return (requestOverride || function () {}).apply(null, arguments);
}

var instanceOverride;
var fakeGcpMetadata = {
  instance: function () {
    return (instanceOverride || function () {}).apply(null, arguments);
  }
};

describe('googleAutoAuth', function () {
  var googleAutoAuth;
  var auth;

  before(function () {
    mockery.registerMock('google-auth-library', fakeGoogleAuthLibrary);
    mockery.registerMock('crypto', fakeCrypto);
    mockery.registerMock('request', fakeRequest);
    mockery.registerMock('gcp-metadata', fakeGcpMetadata);

    mockery.enable({
      useCleanCache: true,
      warnOnUnregistered: false
    });

    googleAutoAuth = require('./index.js');
  });

  after(function () {
    mockery.deregisterAll();
    mockery.disable();
  });

  beforeEach(function () {
    createSignOverride = null;
    requestOverride = null;
    googleAuthLibraryOverride = null;
    instanceOverride = null;
    auth = googleAutoAuth();
  });

  describe('constructor', function () {
    it('should set correct defaults', function () {
      assert.strictEqual(auth.authClientPromise, null);
      assert.strictEqual(auth.authClient, null);
      assert.strictEqual(auth.googleAuthClient, null);
      assert.deepStrictEqual(auth.config, {});
      assert.strictEqual(auth.credentials, null);
      assert.deepStrictEqual(auth.environment, {});
      assert.strictEqual(auth.projectId, undefined);
    });

    it('should cache config', function () {
      var config = {};
      var auth = googleAutoAuth(config);

      assert.strictEqual(auth.config, config);
    });

    it('should cache project ID', function () {
      var auth = googleAutoAuth({
        projectId: 'project-id'
      });

      assert.strictEqual(auth.projectId, 'project-id');
    });
  });

  describe('authorizeRequest', function () {
    it('should get a token', function (done) {
      auth.getToken = function () {
        done();
      };

      auth.authorizeRequest({}, assert.ifError);
    });

    it('should execute callback with error', function (done) {
      var error = new Error('Error.');

      auth.getToken = function (callback) {
        callback(error);
      };

      auth.authorizeRequest({}, function (err) {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should extend the request options with token', function (done) {
      var token = 'abctoken';

      var reqOpts = {
        uri: 'a',
        headers: {
          a: 'b',
          c: 'd'
        }
      };

      var expectedAuthorizedReqOpts = Object.assign({}, reqOpts);
      expectedAuthorizedReqOpts.headers = Object.assign({
        Authorization: `Bearer ${token}`
      }, reqOpts.headers);

      auth.getToken = function (callback) {
        callback(null, token);
      };

      auth.authorizeRequest(reqOpts, function (err, authorizedReqOpts) {
        assert.ifError(err);
        assert.notStrictEqual(authorizedReqOpts, reqOpts);
        assert.notDeepEqual(authorizedReqOpts, reqOpts);
        assert.deepEqual(authorizedReqOpts, expectedAuthorizedReqOpts);
        done();
      });
    });
  });

  describe('getAuthClient', function () {
    beforeEach(function () {
      process.chdir(__dirname);
    });

    it('should re-use an existing authClient', function (done) {
      auth.authClient = { a: 'b', c: 'd' };

      auth.getAuthClient(function (err, authClient) {
        assert.strictEqual(authClient, auth.authClient);
        done();
      });
    });

    it('should re-use an existing authClientPromise', function (done) {
      auth.authClientPromise = Promise.resolve(42);

      auth.getAuthClient(function (err, authClient) {
        assert.ifError(err);
        assert.strictEqual(authClient, 42);
        done();
      });
    });

    it('should create an authClientPromise', function (done) {
      var authClient = {};

      googleAuthLibraryOverride = function () {
        return {
          getApplicationDefault: function (callback) {
            callback(null, authClient);
          }
        };
      };

      auth.getAuthClient(function (err, _authClient) {
        assert.ifError(err);

        assert.strictEqual(_authClient, authClient);

        auth.authClientPromise
          .then(function (authClientFromPromise) {
            assert.strictEqual(authClientFromPromise, authClient);
            done();
          });
      });
    });

    it('should use google-auth-library', function () {
      var googleAuthLibraryCalled = false;

      googleAuthLibraryOverride = function () {
        googleAuthLibraryCalled = true;
        return {
          getApplicationDefault: function () {}
        };
      };

      auth.getAuthClient(assert.ifError);
      assert.strictEqual(googleAuthLibraryCalled, true);
    });

    it('should cache googleAuthClient', function () {
      var googleAuthClient = {
        getApplicationDefault: function () {}
      };

      googleAuthLibraryOverride = function () {
        return googleAuthClient;
      };

      auth.getAuthClient(assert.ifError);
      assert.strictEqual(auth.googleAuthClient, googleAuthClient);
    });

    it('should create a google auth client from JSON', function (done) {
      auth.config = {
        keyFile: '../test.keyfile.json',
        scopes: ['dev.scope']
      };

      var expectedJson = require('./test.keyfile.json');

      var googleAuthClient = {
        createScopedRequired: function () {}
      };
      var projectId = 'project-id';

      googleAuthLibraryOverride = function () {
        return {
          fromJSON: function (json, callback) {
            assert.deepEqual(json, expectedJson);

            callback(null, googleAuthClient, projectId);
          }
        };
      };

      // to test that `path.resolve` is being used
      process.chdir('node_modules');

      auth.getAuthClient(function (err, authClient) {
        assert.ifError(err);

        assert.strictEqual(authClient.scopes, auth.config.scopes);
        assert.strictEqual(auth.projectId, projectId);

        assert.strictEqual(auth.authClient, googleAuthClient);
        assert.strictEqual(authClient, googleAuthClient);

        done();
      });
    });

    it('should see if a file reads as JSON', function (done) {
      auth.config = {
        keyFile: '../test.keyfile',
        scopes: ['dev.scope']
      };

      var expectedJson = JSON.parse(fs.readFileSync('./test.keyfile'));

      var googleAuthClient = {
        createScopedRequired: function () {}
      };
      var projectId = 'project-id';

      googleAuthLibraryOverride = function () {
        return {
          fromJSON: function (json, callback) {
            assert.deepEqual(json, expectedJson);

            callback(null, googleAuthClient, projectId);
          }
        };
      };

      // to test that `path.resolve` is being used
      process.chdir('node_modules');

      auth.getAuthClient(function (err, authClient) {
        assert.ifError(err);

        assert.strictEqual(authClient.scopes, auth.config.scopes);
        assert.strictEqual(auth.projectId, projectId);

        assert.strictEqual(auth.authClient, googleAuthClient);
        assert.strictEqual(authClient, googleAuthClient);

        done();
      });
    });

    it('should create an auth client from credentials', function (done) {
      var googleAuthClient = {
        createScopedRequired: function () {}
      };
      var projectId = 'project-id';

      googleAuthLibraryOverride = function () {
        return {
          fromJSON: function (json, callback) {
            assert.deepEqual(json, auth.config.credentials);

            callback(null, googleAuthClient, projectId);
          }
        };
      };

      auth.config = {
        credentials: { a: 'b', c: 'd' }
      };

      auth.getAuthClient(function (err, authClient) {
        assert.ifError(err);

        assert.strictEqual(auth.projectId, projectId);

        assert.strictEqual(auth.authClient, googleAuthClient);
        assert.strictEqual(authClient, googleAuthClient);

        done();
      });
    });

    it('should prefer the user-provided project ID', function (done) {
      var googleAuthClient = {
        createScopedRequired: function () {}
      };
      var badProjectId = 'bad-project-id';
      var goodProjectId = 'good-project-id';

      googleAuthLibraryOverride = function () {
        return {
          fromJSON: function (json, callback) {
            callback(null, googleAuthClient, badProjectId);
          }
        };
      };

      auth.config = {
        projectId: goodProjectId,
        credentials: { a: 'b', c: 'd' }
      };

      auth.getAuthClient(function (err, authClient) {
        assert.ifError(err);
        assert.strictEqual(auth.projectId, goodProjectId);
        done();
      });
    });

    it('should return error if file does not exist', function (done) {
      googleAuthLibraryOverride = function () {};

      auth.config = {
        keyFilename: 'non-existent-key.pem'
      };

      auth.getAuthClient(function (err) {
        assert(err.message.includes('no such file or directory'));
        done();
      });
    });

    it('should create a JWT auth client from non-JSON', function (done) {
      var jwt = {
        createScopedRequired: function () {}
      };

      googleAuthLibraryOverride = function () {
        return {
          JWT: function () { return jwt; }
        };
      };

      auth.config = {
        keyFilename: './test.keyfile.pem',
        email: 'example@example.com',
        scopes: ['dev.scope']
      };


      auth.getAuthClient(function (err, authClient) {
        assert.ifError(err);

        var expectedKey = path.resolve(process.cwd(), auth.config.keyFilename);
        assert.strictEqual(jwt.keyFile, expectedKey);

        assert.strictEqual(jwt.email, auth.config.email);
        assert.strictEqual(jwt.scopes, auth.config.scopes);

        assert.strictEqual(auth.authClient, jwt);
        assert.strictEqual(authClient, jwt);

        done();
      });
    });

    it('should create an auth client from magic', function (done) {
      var googleAuthClient = {
        createScopedRequired: function () {}
      };

      googleAuthLibraryOverride = function () {
        return {
          getApplicationDefault: function (callback) {
            callback(null, googleAuthClient);
          }
        };
      };

      auth.getAuthClient(function (err, authClient) {
        assert.ifError(err);

        assert.strictEqual(auth.authClient, googleAuthClient);
        assert.strictEqual(authClient, googleAuthClient);

        done();
      });
    });

    it('should return scope error if necessary', function (done) {
      auth.config = {
        scopes: []
      };

      var fakeAuthClient = {
        createScopedRequired: function () {
          return true;
        }
      };

      googleAuthLibraryOverride = function () {
        return {
          getApplicationDefault: function (callback) {
            callback(null, fakeAuthClient);
          }
        };
      };

      auth.getAuthClient(function (e) {
        assert.strictEqual(e.code, 'MISSING_SCOPE');
        assert.strictEqual(e.message, 'Scopes are required for this request.');
        done();
      });
    });

    it('should pass back any errors from the authClient', function (done) {
      var error = new Error('Error.');

      googleAuthLibraryOverride = function () {
        return {
          getApplicationDefault: function (callback) {
            callback(error);
          }
        };
      };

      auth.getAuthClient(function (err) {
        assert.strictEqual(err,error);
        done();
      });
    });
  });

  describe('getCredentials', function () {
    it('should return a cached credentials object', function (done) {
      auth.getAuthClient = function () {
        throw new Error('Should not be executed.')
      };

      auth.credentials = {};

      auth.getCredentials(function (err, credentials) {
        assert.ifError(err);
        assert.strictEqual(credentials, auth.credentials);
        done();
      })
    });

    it('should get an auth client', function (done) {
      auth.getAuthClient = function () {
        done();
      };

      auth.getCredentials(assert.ifError);
    });

    it('should execute callback with error', function (done) {
      var error = new Error('Error.');

      auth.getAuthClient = function (callback) {
        callback(error);
      };

      auth.getCredentials(function (err) {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should execute callback with object', function (done) {
      var credentialsFromAuthClient = {};

      auth.googleAuthClient = {
        getCredentials: function (callback) {
          callback(null, credentialsFromAuthClient);
        }
      };

      auth.getAuthClient = function (callback) {
        callback();
      };

      auth.getCredentials(function (err, creds) {
        assert.ifError(err);

        assert.strictEqual(creds, credentialsFromAuthClient);
        assert.strictEqual(auth.credentials, credentialsFromAuthClient);

        done();
      });
    });

    it('should execute callback with error from client', function (done) {
      var error = new Error('Error.');

      auth.googleAuthClient = {
        getCredentials: function (callback) {
          callback(error);
        }
      };

      auth.getAuthClient = function (callback) {
        callback();
      };

      auth.getCredentials(function (err) {
        assert.strictEqual(err, error);
        done();
      });
    });
  });

  describe('getEnvironment', function () {
    it('should call all environment detection methods', function (done) {
      auth.isAppEngine = function (callback) {
        callback();
      };

      auth.isCloudFunction = function (callback) {
        callback();
      };

      auth.isComputeEngine = function (callback) {
        callback();
      };

      auth.isContainerEngine = function (callback) {
        callback();
      };

      auth.getEnvironment(function (err, environment) {
        assert.ifError(err);
        assert.strictEqual(environment, auth.environment);
        done();
      });
    });
  });

  describe('getProjectId', function () {
    var PROJECT_ID = 'project-id';

    it('should return a project ID if already set', function (done) {
      auth.getAuthClient = function () {
        done(); // Will cause the test to blow up
      };

      auth.projectId = PROJECT_ID;

      auth.getProjectId(function (err, projectId) {
        assert.ifError(err);
        assert.strictEqual(projectId, PROJECT_ID);
        done();
      });
    });

    it('should get an auth client', function (done) {
      auth.getAuthClient = function () {
        done();
      };

      auth.getProjectId(assert.ifError);
    });

    it('should execute callback with error', function (done) {
      var error = new Error('Error.');

      auth.getAuthClient = function (callback) {
        callback(error);
      };

      auth.getProjectId(function (err) {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should get a project ID', function (done) {
      auth.getAuthClient = function (callback) {
        auth.projectId = PROJECT_ID;
        callback();
      };

      auth.getProjectId(function (err, projectId) {
        assert.ifError(err);
        assert.strictEqual(projectId, PROJECT_ID);
        done();
      });
    });
  });

  describe('getToken', function () {
    it('should get an auth client', function (done) {
      auth.getAuthClient = function () {
        done();
      };

      auth.getToken(assert.ifError);
    });

    it('should execute callback with error', function (done) {
      var error = new Error('Error.');

      auth.getAuthClient = function (callback) {
        callback(error);
      };

      auth.getToken(function (err) {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should get an access token', function (done) {
      var fakeClient = {
        getAccessToken: function (callback) {
          callback();
        }
      };

      auth.getAuthClient = function (callback) {
        callback(null, fakeClient);
      };

      auth.getToken(done);
    });
  });

  describe('isAppEngine', function () {
    var ENV_VARS = [
      'GAE_SERVICE',
      'GAE_MODULE_NAME'
    ];

    afterEach(function () {
      ENV_VARS.forEach(function (envVarName) {
        delete process.env[envVarName];
      });
    });

    it('should return false without env vars sets', function (done) {
      auth.isAppEngine(function (err, isAppEngine) {
        assert.ifError(err);
        assert.strictEqual(isAppEngine, false);
        done();
      });
    });

    it('should detect GAE_SERVICE', function (done) {
      process.env.GAE_SERVICE = 'service-name';

      assert.strictEqual(auth.environment.IS_APP_ENGINE, undefined);

      auth.isAppEngine(function (err, isAppEngine) {
        assert.ifError(err);
        assert.strictEqual(auth.environment.IS_APP_ENGINE, true);
        assert.strictEqual(isAppEngine, true);
        done();
      });
    });

    it('should detect GAE_MODULE_NAME', function (done) {
      process.env.GAE_MODULE_NAME = 'module-name';

      assert.strictEqual(auth.environment.IS_APP_ENGINE, undefined);

      auth.isAppEngine(function (err, isAppEngine) {
        assert.ifError(err);
        assert.strictEqual(auth.environment.IS_APP_ENGINE, true);
        assert.strictEqual(isAppEngine, true);
        done();
      });
    });
  });

  describe('isCloudFunction', function () {
    var ENV_VARS = [
      'FUNCTION_NAME'
    ];

    afterEach(function () {
      ENV_VARS.forEach(function (envVarName) {
        delete process.env[envVarName];
      });
    });

    it('should return false without env vars sets', function (done) {
      auth.isCloudFunction(function (err, isCloudFunction) {
        assert.ifError(err);
        assert.strictEqual(isCloudFunction, false);
        done();
      });
    });

    it('should detect FUNCTION_NAME', function (done) {
      process.env.FUNCTION_NAME = 'function-name';

      assert.strictEqual(auth.environment.IS_CLOUD_FUNCTION, undefined);

      auth.isCloudFunction(function (err, isCloudFunction) {
        assert.ifError(err);
        assert.strictEqual(auth.environment.IS_CLOUD_FUNCTION, true);
        assert.strictEqual(isCloudFunction, true);
        done();
      });
    });
  });

  describe('isComputeEngine', function () {
    it('should return an existing value', function (done) {
      requestOverride = done; // will make test fail if called

      auth.environment.IS_COMPUTE_ENGINE = 'test';

      auth.isComputeEngine(function (err, isComputeEngine) {
        assert.ifError(err);
        assert.strictEqual(isComputeEngine, 'test');
        done();
      });
    });

    it('should make the correct request', function (done) {
      requestOverride = function (uri) {
        assert.strictEqual(uri, 'http://metadata.google.internal');
        done();
      };

      auth.isComputeEngine(assert.ifError);
    });

    it('should set false if request errors', function (done) {
      requestOverride = function (uri, callback) {
        callback(new Error(':('));
      };

      assert.strictEqual(auth.environment.IS_COMPUTE_ENGINE, undefined);

      auth.isComputeEngine(function (err, isComputeEngine) {
        assert.ifError(err);
        assert.strictEqual(auth.environment.IS_COMPUTE_ENGINE, false);
        assert.strictEqual(isComputeEngine, false);
        done();
      });
    });

    it('should set true if header matches', function (done) {
      requestOverride = function (uri, callback) {
        callback(null, {
          headers: {
            'metadata-flavor': 'Google'
          }
        });
      };

      assert.strictEqual(auth.environment.IS_COMPUTE_ENGINE, undefined);

      auth.isComputeEngine(function (err, isComputeEngine) {
        assert.ifError(err);
        assert.strictEqual(auth.environment.IS_COMPUTE_ENGINE, true);
        assert.strictEqual(isComputeEngine, true);
        done();
      });
    });
  });

  describe('isContainerEngine', function () {
    it('should return an existing value', function (done) {
      instanceOverride = done; // will make test fail if called

      auth.environment.IS_CONTAINER_ENGINE = 'test';

      auth.isContainerEngine(function (err, isContainerEngine) {
        assert.ifError(err);
        assert.strictEqual(isContainerEngine, 'test');
        done();
      });
    });

    it('should make the correct metadata lookup', function (done) {
      instanceOverride = function (property) {
        assert.strictEqual(property, '/attributes/cluster-name');
        done();
      };

      auth.isContainerEngine(assert.ifError);
    });

    it('should set false if instance request errors', function (done) {
      instanceOverride = function (property, callback) {
        callback(new Error(':('));
      };

      assert.strictEqual(auth.environment.IS_CONTAINER_ENGINE, undefined);

      auth.isContainerEngine(function (err, isContainerEngine) {
        assert.ifError(err);
        assert.strictEqual(auth.environment.IS_CONTAINER_ENGINE, false);
        assert.strictEqual(isContainerEngine, false);
        done();
      });
    });

    it('should set true if instance request succeeds', function (done) {
      instanceOverride = function (property, callback) {
        callback(null);
      };

      assert.strictEqual(auth.environment.IS_CONTAINER_ENGINE, undefined);

      auth.isContainerEngine(function (err, isContainerEngine) {
        assert.ifError(err);
        assert.strictEqual(auth.environment.IS_CONTAINER_ENGINE, true);
        assert.strictEqual(isContainerEngine, true);
        done();
      });
    });
  });

  describe('sign', function () {
    var DATA_TO_SIGN = 'data-to-sign';

    it('should return an error from getCredentials', function (done) {
      var error = new Error('Error.');

      auth.getCredentials = function (callback) {
        callback(error);
      };

      auth.sign(DATA_TO_SIGN, function (err) {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should sign with private key if available', function (done) {
      auth._signWithPrivateKey = function (data, callback) {
        assert.strictEqual(data, DATA_TO_SIGN);
        callback(); // done()
      };

      auth.getCredentials = function (callback) {
        callback(null, {
          private_key: 'private-key'
        });
      };

      auth.sign(DATA_TO_SIGN, done);
    });

    it('should sign with API if private key is not available', function (done) {
      auth._signWithApi = function (data, callback) {
        assert.strictEqual(data, DATA_TO_SIGN);
        callback(); // done()
      };

      auth.getCredentials = function (callback) {
        callback(null, {
          // private_key: 'private-key' (no private_key)
        });
      };

      auth.sign(DATA_TO_SIGN, done);
    });
  });

  describe('_signWithApi', function () {
    var DATA_TO_SIGN = 'data-to-sign';
    var DEFAULT_API_RESPONSE = {
      toJSON: function () {
        return {
          statusCode: 200
        };
      }
    };

    beforeEach(function () {
      auth.projectId = 'project-id';

      auth.credentials = {
        client_email: 'client-email'
      };
    });

    it('should return an error if there is no project ID', function (done) {
      auth.projectId = undefined;

      auth._signWithApi(DATA_TO_SIGN, function (err) {
        assert.strictEqual(err.message, 'Cannot sign data without a project ID.');
        done();
      });
    });

    it('should return an error if there is no client email', function (done) {
      auth.credentials = {
        // client_email: 'client-email' (not available)
      };

      auth._signWithApi(DATA_TO_SIGN, function (err) {
        assert.strictEqual(err.message, 'Cannot sign data without `client_email`.');
        done();
      });
    });

    it('should authorize the signBlob request', function (done) {
      auth.authorizeRequest = function (reqOpts) {
        assert.deepEqual(reqOpts, {
          method: 'POST',
          uri: 'https://iam.googleapis.com/v1/projects/project-id/serviceAccounts/client-email:signBlob',
          json: {
            bytesToSign: Buffer.from(DATA_TO_SIGN).toString('base64')
          }
        });
        done();
      };

      auth._signWithApi(DATA_TO_SIGN, assert.ifError);
    });

    it('should return an error from authorizing the request', function (done) {
      var error = new Error('Error.');

      auth.authorizeRequest = function (reqOpts, callback) {
        callback(error);
      };

      auth._signWithApi(DATA_TO_SIGN, function (err) {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should make the authorized request', function (done) {
      var authorizedReqOpts = {};

      auth.authorizeRequest = function (reqOpts, callback) {
        callback(null, authorizedReqOpts);
      };

      requestOverride = function (reqOpts) {
        assert.strictEqual(reqOpts, authorizedReqOpts);
        done();
      };

      auth._signWithApi(DATA_TO_SIGN, assert.ifError);
    });

    it('should return an error from the request', function (done) {
      var authorizedReqOpts = {};

      auth.authorizeRequest = function (reqOpts, callback) {
        callback(null, authorizedReqOpts);
      };

      var error = new Error('Error.');

      requestOverride = function (reqOpts, callback) {
        callback(error, DEFAULT_API_RESPONSE);
      };

      auth._signWithApi(DATA_TO_SIGN, function (err) {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should return an error in the body from the request', function (done) {
      var authorizedReqOpts = {};

      auth.authorizeRequest = function (reqOpts, callback) {
        callback(null, authorizedReqOpts);
      };

      var signBlobApiError = {
        message: 'Inner error',
        property: 'Inner property'
      };

      var signBlobApiResponse = {
        toJSON: function() {
          return {
            statusCode: 400,
            body: {
              error: signBlobApiError
            }
          };
        }
      }

      requestOverride = function (reqOpts, callback) {
        callback(null, signBlobApiResponse);
      };

      auth._signWithApi(DATA_TO_SIGN, function (err) {
        assert.strictEqual(err.message, signBlobApiError.message);
        assert.strictEqual(err.property, signBlobApiError.property);
        done();
      });
    });

    it('should return a string error in the body from the request', function (done) {
      var authorizedReqOpts = {};

      auth.authorizeRequest = function (reqOpts, callback) {
        callback(null, authorizedReqOpts);
      };

      var signBlobApiError = 'String error message';

      var signBlobApiResponse = {
        toJSON: function() {
          return {
            statusCode: 400,
            body: signBlobApiError
          };
        }
      }

      requestOverride = function (reqOpts, callback) {
        callback(null, signBlobApiResponse);
      };

      auth._signWithApi(DATA_TO_SIGN, function (err) {
        assert.strictEqual(err.message, signBlobApiError);
        done();
      });
    });

    it('should return the signature', function (done) {
      var authorizedReqOpts = {};

      auth.authorizeRequest = function (reqOpts, callback) {
        callback(null, authorizedReqOpts);
      };

      var body = {
        signature: 'signature'
      };

      requestOverride = function (reqOpts, callback) {
        callback(null, DEFAULT_API_RESPONSE, body);
      };

      auth._signWithApi(DATA_TO_SIGN, function (err, signature) {
        assert.ifError(err);
        assert.strictEqual(signature, body.signature);
        done();
      });
    });
  });

  describe('_signWithPrivateKey', function () {
    var DATA_TO_SIGN = 'data-to-sign';

    beforeEach(function () {
      auth.credentials = {
        private_key: 'private-key'
      };
    });

    it('should return the signature', function (done) {
      var updatedWithCorrectData = false;
      var expectedSignature = 'signed-data';

      createSignOverride = function (algo) {
        assert.strictEqual(algo, 'RSA-SHA256');

        return {
          sign: function (private_key, outputFormat) {
            assert.strictEqual(private_key, auth.credentials.private_key);
            return expectedSignature;
          },

          update: function (data) {
            assert.strictEqual(data, DATA_TO_SIGN);
            updatedWithCorrectData = true;
          }
        };
      };

      auth._signWithPrivateKey(DATA_TO_SIGN, function (err, signature) {
        assert.ifError(err);
        assert.strictEqual(updatedWithCorrectData, true);
        assert.strictEqual(signature, expectedSignature);
        done();
      });
    });
  });
});
