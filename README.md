# Koa-Beatrix

This module provides a [koa](https://koajs.com) middleware that runs requests in a [beatrix](https://npmjs.com/package/beatrix) (RabbitMQ) queue.

Requests are therefore automatically rate-limited, fault-resilient, and distributed.

## Example
```javascript
const Koa = require('koa');
const app = new Koa();

const KoaBeatrix = require('koa-beatrix');
const Queues = KoaBeatrix(app, {
    prefix: 'myapp',
    beatrix: {
        // standard beatrix options
    },
    concurrency: 3 // default queue options may be included here
})

app.use(Queues.queue('example', {
    // standard queue creation options
    concurrency: 5, // overrides the default
    maxAttempts: 3,
    delay: 1
}));

// following middleware will be run inside the queue `myapp.example`
app.use((ctx, next) => {
    ctx.body = 'ok'
})
```

## Usage
### `KoaBeatrix(app, config) => {queue: Function, beatrix: Beatrix}`
`app` must be a Koa instance.
`config` should be an object containing any of the following optional parameters:
>>> `beatrix` - either a Beatrix instance, or a Beatrix options object. If it doesn't exist it looks on `app.context.beatrix`
`prefix = String` - an optional prefix for all queues in this group
`nameFromPath = Boolean` - if true, queue names are taken from prefix+path like "myapp.index"
`onSuccess(ctx, result)` - called when a job completes within the allowed time with the ctx of the request and the result of the job as {status, body, headers}. Defaults to sending the result as-is.
`onError(ctx, err)` - called when a job fails all retries within the allowed time with the ctx of the request and the error object. Defaults to status=500 and sending the message of the error as the body.
`onTimeout(ctx)` - called when a job does not complete/fail before the allowed time of the request. Defaults to status=202

`config` may also include any standard Beatrix Queue parameters such as `maxAttempts`, `bypass`, `replyTimeout`

### `KoaBeatrix().queue(name, config) => middleware`
`name` is required unless `nameFromPath` is true
`config` will override any config from the KoaBeatrix() call
The returned middleware can be used in a router or directly on the app