const util = require('../util')
const tracer = require('../core/tracer')

module.exports = function (object) {
  let patches = {
    Collection: (object, method, options) => {
      util.wrap(object, method, original => {
        return function (...args) {
          let stringArgs = args.map(JSON.stringify).join(',')

          let parent = tracer.currentSpan()
          let span = parent.startSpan('MongoDB ' + method, {
            'db.instance': this.s.dbName,
            'db.statement': `${this.namespace}.${method}(${stringArgs})`,
            'db.type': 'mongodb',
            'span.kind': 'client'
          })

          if (options.callback) {
            let last = args.length - 1
            let callback = args[last]

            if (typeof callback === 'function') {
              args[last] = function (err, value) {
                span.finish(err)
                return callback.apply(this, arguments)
              }
              return original.apply(this, args)
            }
          }

          if (options.promise) {
            return original.apply(this, args).then(
              value => {
                span.finish()
                return value
              },
              err => {
                span.finish(err)
                throw err
              }
            )
          }

          try {
            var result = original.apply(this, arguments)
          } catch (err) {
            span.finish(err)
            throw err
          }

          span.finish()
          return result
        }
      })
    }
  }

  object.instrument(null, (err, modules) => {
    if (err) {
      console.warn('Could not instrument MongoDB for Jaeger')
      return
    }

    modules.forEach(module => {
      let patch = patches[module.name]

      if (patch == null) {
        return
      }

      module.instrumentations.forEach(instrumentation => {
        let target = instrumentation.options.static ? module.obj : module.obj.prototype

        instrumentation.methods.forEach(method => {
          patch(target, method, instrumentation.options)
        })
      })
    })
  })
}
