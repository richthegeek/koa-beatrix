const Beatrix = require('beatrix');
const _ = require('lodash');
const Request = require('mock-req');
const Response = require('mock-res');

const KoaBeatrix = function (app, options) {
  let self = {
    id: _.uniqueId('koa-beatrix-instance'),
    options: options // todo: defaults
  }

  _.defaults(self.options, {
    prefix: '',
    nameFromPath: false,
    process: getJobProcessor(app.callback()),
    onSuccess: (ctx, result) => {
      ctx.status = Number(_.get(result, 'status', 200));
      _.forEach(result.headers, (val, key) => ctx.set(key, val))
      return ctx.body = result.body;
    },
    onTimeout: (ctx) => {
      ctx.status = 202;
    },
    onError: (ctx, err) => {
      ctx.status = _.get(err, 'status', 500);
      return ctx.body = _.get(err, 'message', err);
    }
  })

  if (app.context.beatrix) {
    self.beatrix = app.context.beatrix;
  } else if (_.get(options.beatrix, 'assertQueue')) {
    self.beatrix = options.beatrix;
  } else if (_.has(options, 'beatrix')) {
    self.beatrix = Beatrix(options.beatrix)
  } else {
    throw new Error('Unable to find a Beatrix source');
  }

  /* The flow is slightly roundabout, but like so:
      1. request A enters the router and hits the KoaBeatrix().queue() middleware
      2. request A is queued up, and waits
      3. processor builds a new request B and sends it back to the router
      4. request B enters the middleware, but this time is continuined
      5. request B finished and job resolves/rejects
      6. request A responds to the client with the result
    */
  const makeQueue = (name, config = {}) => {
    _.defaults(config, _.omit(self.options, 'beatrix'))

    let queue;
    let queueConfig = _.omit(config, 'onSuccess', 'onTimeout', 'onError');

    if (config.nameFromPath !== true) {
      queue = self.beatrix.assertQueue([self.options.prefix, name].filter(Boolean).join('.'), queueConfig);
    }

    return (ctx, next) => {
      if (ctx.req.fromBeatrix) {
        // this prevents the error from immediately killing the request
        // instead it can be picked up by the job processor loop
        // to reject the job for possible retry
        ctx.onerror = (err) => ctx.req.jobRunError = err;
        // ctx.state is the only supported non-standard property
        ctx.state = ctx.req.fromBeatrix;
        return next()
      }

      let req = _.pick(ctx.req, [
        'url', 'method', 'protocol', 'origin', 'href', 'path',
        'headers','body', 'query', 'params'
      ]);
      req.socket = {encrypted: ctx.socket.encrypted}; // required for Koa to not bork
      req.state = ctx.state;

      if (config.nameFromPath === true) {
        let queueName = [self.options.prefix]
        queueName.push(_.trim(ctx.path, '/').replace(/\//g, '-').replace(/^$/, 'index').toLowerCase());

        queue = self.beatrix.assertQueue(queueName.filter(Boolean).join('.'), queueConfig);
      }

      return queue.request(req, config).then((result) => {
        return config.onSuccess(ctx, result)
      }).catch((err) => {
        if (_.get(err, 'code') === 'ETIMEOUT') {
          return config.onTimeout(ctx);
        } else {
          return config.onError(ctx, err);
        }
      });
    }
  }

  return {
    queue: makeQueue,
    beatrix: self.beatrix
  }
}

const getJobProcessor = (callback) => {
  return async (job) => {
    let req = new Request();
    let res = new Response();

    // copy everything over here rather than in new Request
    // because mock-req only supports half the parameters
    _.assign(req, job.body);

    // relay this here, as well as to mark the request
    // as being a job so that it doesnt instantly requeue it
    req.job = job;
    req.fromBeatrix = job.body.state;

    try {
      await callback(req, res);

      // ctx.onerror catches errors, so break out here
      if (req.jobRunError) {
        throw req.jobRunError;
      }

      return job.resolve({
        headers: res.getHeaders(),
        status: res.statusCode,
        body: res._getString()
      })
    } catch (err) {
      job.retry(_.get(err, 'retry', true));
      return job.reject(_.get(err, 'message', err));
    }
  }
}

module.exports = KoaBeatrix;