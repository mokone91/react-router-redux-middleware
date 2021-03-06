var path = require("path");
var Provider = require("react-redux").Provider;
var renderToString = require("react-dom/server").renderToString;
var React = require("react");
var ReactRouter = require("react-router");

var match = ReactRouter.match;
var RouterContext = ReactRouter.RouterContext;

function sendError(config, options) {
    config.res
        .status(config.code)
        .send(options.errorTemplate(config));
}

function waitForTemplate(options) {

    return (new Promise(function(resolve) {

        if (!options.fs.existsSync(options.templatePath) || !options.__templateHtml) {

            var interval = setInterval(function() {

                if (options.fs.existsSync(options.templatePath)) {
                    options.__templateHtml = options.fs.readFileSync(options.templatePath).toString(); //FIXME
                    clearInterval(interval);
                    resolve(options.__templateHtml);
                }

            }, 200);

        } else {
            resolve(options.__templateHtml);
        }

    }));

}

function renderFullPage(config, options) {

    return waitForTemplate(options).then(function(templateHtml) {

        var parsedTemplate = options.template({
            component: config.component,
            html: config.html,
            initialProps: config.initialProps,
            store: config.store,
            req: config.req,
            res: config.res,
            template: templateHtml
        });

        if (typeof parsedTemplate !== 'string') throw new Error('Return type of options.template() has to be a string');

        return parsedTemplate.replace(
            '<head>', // this should be the first script on a page so that others can pick it up
            '<head><script type="text/javascript">window["' + options.initialStateKey + '"] = ' + JSON.stringify(config.store.getState()) + ';</script>'
        );

    });

}

function errorTemplate(config) {
    if (config.html) return config.html;
    return (
        "<h1>" + config.code + " Server Error</h1>" +
        "<h2>" + (config.error.message || config.error) + "</h2>" +
        "<pre>" + (config.error.stack || config.error) + "</pre>"
    );
}

function middleware(options, routes, history, req, res, next) {

    var location = history.createLocation(req.url);
    var store = options.createStore({req: req, res: res});

    if (
        options.fs.existsSync(path.join(options.outputPath, location.pathname)) &&
        !~options.ignoreUrls.indexOf(location.pathname)
    ) {
        if (options.debug) console.log('Static', location.pathname);
        return next();
    }

    match({routes: routes, location: location}, function(error, redirectLocation, renderProps) {

        if (options.debug) console.log('Rendering', location.pathname + location.search);

        if (redirectLocation) {
            return res.redirect(301, redirectLocation.pathname + redirectLocation.search);
        }

        if (error) {
            return sendError({
                core: 502,
                error: error,
                req: req,
                res: res
            }, options);
        }

        if (renderProps === null) {
            return sendError({
                code: 404,
                html: renderFullPage({
                    req: req,
                    res: res,
                    component: null,
                    initialProps: null,
                    html: '',
                    store: store
                }, options),
                req: req,
                res: res
            }, options);
        }

        new Promise(function(resolve) {

            var Cmp = renderProps.components[renderProps.components.length - 1].WrappedComponent;

            if (!Cmp || !Cmp[options.getInitialPropsKey]) {
                return resolve([Cmp]);
            }

            resolve(Promise.all([
                Cmp,
                Cmp[options.getInitialPropsKey]({
                    history: history,
                    location: renderProps.location,
                    params: renderProps.params,
                    query: renderProps.query,
                    req: req,
                    res: res,
                    store: store
                })
            ]));

        }).then(function(result) {

            var Cmp = result[0]; //TODO Wrap component and inject initialProps if possible
            var initialProps = result[1];
            var html = renderToString(
                React.createElement(
                    Provider,
                    {store: store},
                    React.createElement(RouterContext, renderProps)
                )
            );

            // console.log('Initial props', initialProps);
            // console.log('Store state before rendering', store.getState());

            res.status(Cmp && !Cmp[options.notFoundKey] ? 200 : 404);

            return renderFullPage({
                component: Cmp,
                html: html,
                initialProps: initialProps,
                req: req,
                res: res,
                store: store
            }, options);

        }).then(res.send.bind(res)).catch(function(e) {
            return sendError({
                code: 500,
                error: e,
                req: req,
                res: res
            }, options);
        });

    });

}

exports.sendError = sendError;
exports.middleware = middleware;
exports.errorTemplate = errorTemplate;
exports.renderFullPage = renderFullPage;
exports.waitForTemplate = waitForTemplate;