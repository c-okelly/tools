/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import * as bowerConfig from 'bower-config';
import * as cleankill from 'cleankill';
import * as express from 'express';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';
import {MainlineServer, PolyserveServer, RequestHandler, ServerOptions, startServers, VariantServer} from 'polyserve';
import * as semver from 'semver';
import * as send from 'send';
import * as serverDestroy from 'server-destroy';

import {getPackageName, NPMPackage, resolveWctNpmEntrypointNames} from './config';
import {Context} from './context';

// Template for generated indexes.
const INDEX_TEMPLATE = _.template(fs.readFileSync(
    path.resolve(__dirname, '../data/index.html'), {encoding: 'utf-8'}));

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

// scripts to be injected into the running test
const ENVIRONMENT_SCRIPTS: NPMPackage[] = [
  {name: 'stacky', jsEntrypoint: 'browser.js'},
  {name: 'async', jsEntrypoint: 'lib/async.js'},
  {name: 'lodash', jsEntrypoint: 'index.js'},
  {name: 'mocha', jsEntrypoint: 'mocha.js'},
  {name: 'chai', jsEntrypoint: 'chai.js'},
  {name: '@polymer/sinonjs', jsEntrypoint: 'sinon.js'},
  {name: 'sinon-chai', jsEntrypoint: 'lib/sinon-chai.js'},
  {
    name: 'accessibility-developer-tools',
    jsEntrypoint: 'dist/js/axs_testing.js'
  },
  {name: '@polymer/test-fixture', jsEntrypoint: 'test-fixture.js'},
];

/**
 * The webserver module is a quasi-plugin. This ensures that it is hooked in a
 * sane way (for other plugins), and just follows the same flow.
 *
 * It provides a static HTTP server for serving the desired tests and WCT's
 * `browser.js`/`environment.js`.
 */
export function webserver(wct: Context): void {
  const options = wct.options;

  wct.hook('configure', async function() {
    // For now, you should treat all these options as an implementation detail
    // of WCT. They may be opened up for public configuration, but we need to
    // spend some time rationalizing interactions with external webservers.
    options.webserver = _.merge(options.webserver, {});

    if (options.verbose) {
      options.clientOptions.verbose = true;
    }

    // Hacky workaround for Firefox + Windows issue where FF screws up pathing.
    // Bug: https://github.com/Polymer/web-component-tester/issues/194
    options.suites = options.suites.map((cv) => cv.replace(/\\/g, '/'));

    // The generated index needs the correct "browser.js" script. When using
    // npm, the wct-browser-legacy package may be used, so we test for that
    // package and will use its "browser.js" if present.
    let browserScript = 'web-component-tester/browser.js';
    if (options.npm) {
      try {
        const wctBrowserLegacyPath =
            path.join(options.root, 'node_modules', 'wct-browser-legacy');
        const version =
            require(path.join(wctBrowserLegacyPath, 'package.json')).version;
        if (version) {
          browserScript = 'wct-browser-legacy/browser.js';
        }
      } catch (e) {
        // Safely ignore.
      }
      const packageName = getPackageName(options);
      const isPackageScoped = packageName && packageName[0] === '@';

      // concat options.clientOptions.environmentScripts with resolved
      // ENVIRONMENT_SCRIPTS
      options.clientOptions = options.clientOptions || {};
      options.clientOptions.environmentScripts =
          options.clientOptions.environmentScripts || [];
      options.clientOptions.environmentScripts =
          options.clientOptions.environmentScripts.concat(
              resolveWctNpmEntrypointNames(options, ENVIRONMENT_SCRIPTS));

      if (isPackageScoped) {
        browserScript = `../${browserScript}`;
      }
    }
    const a11ySuiteScript = 'web-component-tester/data/a11ySuite.js';
    options.webserver._generatedIndexContent = INDEX_TEMPLATE(
        Object.assign({browserScript, a11ySuiteScript}, options));
  });

  wct.hook('prepare', async function() {
    const wsOptions = options.webserver;
    const additionalRoutes = new Map<string, RequestHandler>();

    const packageName = getPackageName(options);
    let componentDir;

    // Check for client-side compatibility.

    // Non-npm case.
    if (!options.npm) {
      componentDir = bowerConfig.read(options.root).directory;
      const pathToLocalWct =
          path.join(options.root, componentDir, 'web-component-tester');
      let version: string|undefined = undefined;
      const mdFilenames = ['package.json', 'bower.json', '.bower.json'];
      for (const mdFilename of mdFilenames) {
        const pathToMetadata = path.join(pathToLocalWct, mdFilename);
        try {
          if (!version) {
            version = require(pathToMetadata).version;
          }
        } catch (e) {
          // Handled below, where we check if we found a version.
        }
      }
      if (!version) {
        throw new Error(`
The web-component-tester Bower package is not installed as a dependency of this project (${
            packageName}).

Please run this command to install:
    bower install --save-dev web-component-tester

Web Component Tester >=6.0 requires that support files needed in the browser are installed as part of the project's dependencies or dev-dependencies. This is to give projects greater control over the versions that are served, while also making Web Component Tester's behavior easier to understand.

Expected to find a ${mdFilenames.join(' or ')} at: ${pathToLocalWct}/
`);
      }

      const allowedRange =
          require(path.join(
              __dirname, '..', 'package.json'))['--private-wct--']
                                               ['client-side-version-range'] as
          string;
      if (!semver.satisfies(version, allowedRange)) {
        throw new Error(`
    The web-component-tester Bower package installed is incompatible with the
    wct node package you're using.

    The test runner expects a version that satisfies ${allowedRange} but the
    bower package you have installed is ${version}.
`);
      }

      let hasWarnedBrowserJs = false;
      additionalRoutes.set('/browser.js', function(request, response) {
        if (!hasWarnedBrowserJs) {
          console.warn(`

          WARNING:
          Loading WCT's browser.js from /browser.js is deprecated.

          Instead load it from ../web-component-tester/browser.js
          (or with the absolute url /components/web-component-tester/browser.js)
        `);
          hasWarnedBrowserJs = true;
        }
        const browserJsPath = path.join(pathToLocalWct, 'browser.js');
        send(request, browserJsPath).pipe(response);
      });
    }

    const pathToGeneratedIndex =
        `/components/${packageName}/generated-index.html`;
    additionalRoutes.set(pathToGeneratedIndex, (_request, response) => {
      response.set(DEFAULT_HEADERS);
      response.send(options.webserver._generatedIndexContent);
    });

    const appMapper = async (app: express.Express, options: ServerOptions) => {
      // Using the define:webserver hook to provide a mapper function that
      // allows user to substitute their own app for the generated polyserve
      // app.
      await wct.emitHook(
          'define:webserver', app, (substitution: express.Express) => {
            app = substitution;
          }, options);
      return app;
    };

    // Serve up project & dependencies via polyserve
    const polyserveResult = await startServers(
        {
          root: options.root,
          componentDir,
          compile: options.compile,
          hostname: options.webserver.hostname,
          port: options.webserver.port,
          headers: DEFAULT_HEADERS,
          packageName,
          additionalRoutes,
          npm: !!options.npm,
          moduleResolution: options.moduleResolution,
          proxy: options.proxy,
        },
        appMapper);

    let servers: Array<MainlineServer|VariantServer>;

    const onDestroyHandlers: Array<() => Promise<void>> = [];
    const registerServerTeardown = (serverInfo: PolyserveServer) => {
      const destroyableServer = serverInfo.server as any;
      serverDestroy(destroyableServer);
      onDestroyHandlers.push(() => {
        destroyableServer.destroy();
        return new Promise<void>(
            (resolve) => serverInfo.server.on('close', () => resolve()));
      });
    };

    if (polyserveResult.kind === 'mainline') {
      servers = [polyserveResult];
      registerServerTeardown(polyserveResult);
      wsOptions.port = polyserveResult.server.address().port;
    } else if (polyserveResult.kind === 'MultipleServers') {
      servers = [polyserveResult.mainline];
      servers = servers.concat(polyserveResult.variants);
      wsOptions.port = polyserveResult.mainline.server.address().port;
      for (const server of polyserveResult.servers) {
        registerServerTeardown(server);
      }
    } else {
      const never: never = polyserveResult;
      throw new Error(
          `Internal error: Got unknown response from polyserve.startServers:` +
          `${never}`);
    }

    wct._httpServers = servers.map((s) => s.server);

    // At this point, we allow other plugins to hook and configure the
    // webservers as they please.
    for (const server of servers) {
      await wct.emitHook('prepare:webserver', server.app);
    }

    options.webserver._servers = servers.map((s) => {
      const port = s.server.address().port;
      const hostname = s.options.hostname;
      const url = `http://${hostname}:${port}${pathToGeneratedIndex}`;
      return {url, variant: s.kind === 'mainline' ? '' : s.variantName};
    });

    // TODO(rictic): re-enable this stuff. need to either move this code into
    //     polyserve or let the polyserve API expose this stuff.
    // app.use('/httpbin', httpbin.httpbin);

    // app.get('/favicon.ico', function(request, response) {
    //   response.end();
    // });

    // app.use(function(request, response, next) {
    //   wct.emit('log:warn', '404', chalk.magenta(request.method),
    //   request.url);
    //   next();
    // });

    async function interruptHandler() {
      // close the socket IO server directly if it is spun up
      for (const io of (wct._socketIOServers || [])) {
        // we will close the underlying server ourselves
        (<any>io).httpServer = null;
        io.close();
      }
      await Promise.all(onDestroyHandlers.map((f) => f()));
    }
    cleankill.onInterrupt(() => {
      return new Promise((resolve) => {
        interruptHandler().then(() => resolve(), resolve);
      });
    });
  });
}

function exists(path: string): boolean {
  try {
    fs.statSync(path);
    return true;
  } catch (_err) {
    return false;
  }
}

// HACK(rictic): remove this ES6-compat hack and export webserver itself
webserver['webserver'] = webserver;

module.exports = webserver;
