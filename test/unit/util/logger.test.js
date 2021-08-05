/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

// TODO: convert to normal tap style.
// Below allows use of mocha DSL with tap runner.
require('tap').mochaGlobals()

var Logger = require('../../../lib/util/logger')
var chai = require('chai')
var expect = chai.expect
const { Transform } = require('stream')

var DEFAULT_KEYS = ['hostname', 'level', 'msg', 'name', 'pid', 'time', 'v']

describe('logger', function () {
  var results
  var logger

  beforeEach(function () {
    results = []
    logger = new Logger({
      name: 'my-logger',
      level: 'info',
      hostname: 'my-host',
      stream: new Transform({
        transform: addResult
      })
    })
  })

  function addResult(data, encoding, done) {
    results = results.concat(data.toString().split('\n').filter(Boolean).map(JSON.parse))
    done()
  }

  it('should interpolate values', function (done) {
    logger.info('%d: %s', 1, 'a')
    logger.info('123', 4, '5')
    process.nextTick(function () {
      expect(results.length).equal(2)
      expectEntry(results[0], '1: a', 30)
      expectEntry(results[1], '123 4 5', 30)
      done()
    })
  })

  it('should default to error level logging', function () {
    logger.level('donkey kong')
    expect(logger.options._level).equal(50)
  })

  it('should support prepended extras', function (done) {
    logger.info({ a: 1, b: 2 }, '%d: %s', 1, 'a')
    logger.info({ a: 1, b: 2 }, '123', 4, '5')
    process.nextTick(function () {
      var keys = ['a', 'b'].concat(DEFAULT_KEYS)
      expect(results.length).equal(2)
      expectEntry(results[0], '1: a', 30, keys)
      expect(results[0].a).equal(1)
      expect(results[0].b).equal(2)
      expectEntry(results[1], '123 4 5', 30, keys)
      expect(results[1].a).equal(1)
      expect(results[1].b).equal(2)
      done()
    })
  })

  it('should support prepended extras from Error objects', function (done) {
    var error = new Error('error1')
    expect(error.message).to.not.be.undefined
    expect(error.stack).to.not.be.undefined

    logger.info(error, 'log message')
    process.nextTick(function () {
      var log1 = results[0]
      expect(log1.message).equal(error.message)
      expect(log1.stack).equal(error.stack)
      done()
    })
  })

  it('should only log expected levels', function (done) {
    logger.trace('trace')
    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')
    logger.fatal('fatal')
    process.nextTick(function () {
      expect(results.length).equal(4)
      expectEntry(results[0], 'info', 30)
      expectEntry(results[1], 'warn', 40)
      expectEntry(results[2], 'error', 50)
      expectEntry(results[3], 'fatal', 60)

      logger.level('trace')
      logger.trace('trace')
      logger.debug('debug')
      expect(results.length).equal(6)
      expectEntry(results[4], 'trace', 10)
      expectEntry(results[5], 'debug', 20)
      done()
    })
  })

  it('and its children should only log expected levels', function (done) {
    var child = logger.child({ aChild: true })
    var grandchild = child.child({ aGrandchild: true })

    child.trace('trace')
    child.debug('debug')
    child.info('info')
    child.warn('warn')
    child.error('error')
    child.fatal('fatal')
    grandchild.trace('trace')
    grandchild.debug('debug')
    grandchild.info('info')
    grandchild.warn('warn')
    grandchild.error('error')
    grandchild.fatal('fatal')
    process.nextTick(function () {
      expect(results.length).equal(8)
      expectEntry(results[0], 'info', 30, ['aChild'].concat(DEFAULT_KEYS))
      expectEntry(results[1], 'warn', 40, ['aChild'].concat(DEFAULT_KEYS))
      expectEntry(results[2], 'error', 50, ['aChild'].concat(DEFAULT_KEYS))
      expectEntry(results[3], 'fatal', 60, ['aChild'].concat(DEFAULT_KEYS))
      expectEntry(results[4], 'info', 30, ['aChild', 'aGrandchild'].concat(DEFAULT_KEYS))
      expectEntry(results[5], 'warn', 40, ['aChild', 'aGrandchild'].concat(DEFAULT_KEYS))
      expectEntry(results[6], 'error', 50, ['aChild', 'aGrandchild'].concat(DEFAULT_KEYS))
      expectEntry(results[7], 'fatal', 60, ['aChild', 'aGrandchild'].concat(DEFAULT_KEYS))

      logger.level('trace')
      child.trace('trace')
      grandchild.debug('debug')
      expect(results.length).equal(10)
      expectEntry(results[8], 'trace', 10, ['aChild'].concat(DEFAULT_KEYS))
      expectEntry(results[9], 'debug', 20, ['aChild', 'aGrandchild'].concat(DEFAULT_KEYS))
      done()
    })
  })

  it('and its children should be togglable', function (done) {
    var child = logger.child({ aChild: true })
    var grandchild = child.child({ aGrandchild: true })

    logger.info('on')
    child.info('on')
    grandchild.info('on')
    logger.setEnabled(false)
    process.nextTick(function () {
      expect(results.length).equal(3)
      logger.info('off')
      child.info('off')
      grandchild.info('off')
      expect(results.length).equal(3)
      done()
    })
  })

  it('state should be synced between parent and child', function (done) {
    var child = logger.child({ aChild: true })
    var grandchild = child.child({ aGrandchild: true })

    logger.info('on')
    child.info('on')
    grandchild.info('on')
    child.setEnabled(false)
    process.nextTick(function () {
      expect(results.length).equal(3)
      logger.info('off')
      child.info('off')
      grandchild.info('off')
      expect(results.length).equal(3)
      done()
    })
  })

  it('state should work on arbitrarily deep child loggers', function (done) {
    var child = logger.child({ aChild: true })
    var grandchild = child.child({ aGrandchild: true })

    logger.info('on')
    child.info('on')
    grandchild.info('on')
    grandchild.setEnabled(false)
    process.nextTick(function () {
      expect(results.length).equal(3)
      logger.info('off')
      child.info('off')
      grandchild.info('off')
      expect(results.length).equal(3)
      done()
    })
  })

  it('should support child loggers', function (done) {
    var childA = logger.child({ a: 1 })
    var childB = logger.child({ b: 2, c: 3 })
    var childC = childB.child({ c: 6 })
    childA.info('hello a')
    childB.info({ b: 5 }, 'hello b')
    childC.info({ a: 10 }, 'hello c')

    process.nextTick(function () {
      expect(results.length).equal(3)
      expect(results[0].a).equal(1)
      expectEntry(results[1], 'hello b', 30, ['b', 'c'].concat(DEFAULT_KEYS))
      expect(results[1].b).equal(5)
      expect(results[1].c).equal(3)

      expectEntry(results[2], 'hello c', 30, ['a', 'b', 'c'].concat(DEFAULT_KEYS))
      expect(results[2].a).equal(10)
      expect(results[2].b).equal(2)
      expect(results[2].c).equal(6)
      done()
    })
  })

  it('should support child loggers with prepended extras from Error objects', function (done) {
    var error = new Error('error1')
    expect(error.message).to.not.be.undefined
    expect(error.stack).to.not.be.undefined

    var child = logger.child({ a: 1 })
    child.info(error, 'log message')

    process.nextTick(function () {
      var log1 = results[0]
      expect(log1.message).equal(error.message)
      expect(log1.stack).equal(error.stack)
      done()
    })
  })

  describe('should have once methods', function () {
    it('that respect log levels', function (done) {
      logger.level('info')
      logger.traceOnce('test', 'value')
      process.nextTick(function () {
        expect(results.length).equal(0)
        logger.infoOnce('test', 'value')
        process.nextTick(function () {
          expect(results.length).equal(1)
          expectEntry(results[0], 'value', 30, DEFAULT_KEYS)
          done()
        })
      })
    })

    it('that log things once', function (done) {
      logger.infoOnce('testkey', 'info')
      logger.infoOnce('testkey', 'info')
      logger.infoOnce('anothertestkey', 'another')

      process.nextTick(function () {
        expect(results.length).equal(2)
        expectEntry(results[0], 'info', 30, DEFAULT_KEYS)
        expectEntry(results[1], 'another', 30, DEFAULT_KEYS)
        done()
      })
    })

    it('that can handle objects', function (done) {
      logger.infoOnce('a', { a: 2 }, 'hello a')
      logger.infoOnce('a', { a: 2 }, 'hello c')

      process.nextTick(function () {
        expect(results.length).equal(1)
        expect(results[0].a).equal(2)
        expectEntry(results[0], 'hello a', 30, ['a'].concat(DEFAULT_KEYS))
        done()
      })
    })
  })

  describe('should have once per interval methods', function () {
    it('that respect log levels', function (done) {
      logger.level('info')
      logger.traceOncePer('test', 30, 'value')
      process.nextTick(function () {
        expect(results.length).equal(0)
        logger.infoOncePer('test', 30, 'value')
        process.nextTick(function () {
          expect(results.length).equal(1)
          expectEntry(results[0], 'value', 30, DEFAULT_KEYS)
          done()
        })
      })
    })

    it('that log things at most once in an interval', function (done) {
      logger.infoOncePer('key', 50, 'value')
      logger.infoOncePer('key', 50, 'value')
      setTimeout(function () {
        logger.infoOncePer('key', 50, 'value')
        process.nextTick(function () {
          expect(results.length).equal(2)
          expectEntry(results[0], 'value', 30, DEFAULT_KEYS)
          expectEntry(results[1], 'value', 30, DEFAULT_KEYS)
          done()
        })
      }, 100)
    })
    it('that can handle objects', function (done) {
      logger.infoOncePer('a', 10, { a: 2 }, 'hello a')

      process.nextTick(function () {
        expect(results.length).equal(1)
        expect(results[0].a).equal(2)
        expectEntry(results[0], 'hello a', 30, ['a'].concat(DEFAULT_KEYS))
        done()
      })
    })
  })

  describe('should have enabled methods', function () {
    it('that respect log levels', function () {
      logger.level('info')
      expect(logger.traceEnabled()).to.be.false
      expect(logger.debugEnabled()).to.be.false
      expect(logger.infoEnabled()).to.be.true
      expect(logger.warnEnabled()).to.be.true
      expect(logger.errorEnabled()).to.be.true
      expect(logger.fatalEnabled()).to.be.true
    })

    it('that change with the log level', function () {
      logger.level('fatal')
      expect(logger.traceEnabled()).to.be.false
      expect(logger.debugEnabled()).to.be.false
      expect(logger.infoEnabled()).to.be.false
      expect(logger.warnEnabled()).to.be.false
      expect(logger.errorEnabled()).to.be.false
      expect(logger.fatalEnabled()).to.be.true

      logger.level('trace')
      expect(logger.traceEnabled()).to.be.true
      expect(logger.debugEnabled()).to.be.true
      expect(logger.infoEnabled()).to.be.true
      expect(logger.warnEnabled()).to.be.true
      expect(logger.errorEnabled()).to.be.true
      expect(logger.fatalEnabled()).to.be.true
    })
  })

  it('should stringify objects', function (done) {
    var obj = { a: 1, b: 2 }
    obj.self = obj
    logger.info('JSON: %s', obj)
    process.nextTick(function () {
      expect(results.length).equal(1)
      expectEntry(results[0], 'JSON: {"a":1,"b":2,"self":"[Circular ~]"}', 30)
      done()
    })
  })

  it('fail gracefully on unstringifiable objects', function (done) {
    var badObj = {
      get testData() {
        throw new Error()
      }
    }
    logger.info('JSON: %s', badObj)
    process.nextTick(function () {
      expect(results.length).equal(1)
      expectEntry(results[0], 'JSON: [UNPARSABLE OBJECT]', 30)
      done()
    })
  })
})

describe('logger write queue', function () {
  it('should buffer writes', function (done) {
    var bigString = new Array(16 * 1024).join('a')

    var logger = new Logger({
      name: 'my-logger',
      level: 'info',
      hostname: 'my-host'
    })

    logger.once('readable', function () {
      logger.push = function (str) {
        var pushed = Logger.prototype.push.call(this, str)
        if (pushed) {
          var parts = str
            .split('\n')
            .filter(Boolean)
            .map(function (a) {
              return a.toString()
            })
            .map(JSON.parse)
          expectEntry(parts[0], 'b', 30)
          expectEntry(parts[1], 'c', 30)
          expectEntry(parts[2], 'd', 30)
        }

        return pushed
      }

      logger.info('b')
      logger.info('c')
      logger.info('d')

      logger.read()

      process.nextTick(function () {
        done()
      })
    })
    logger.info(bigString)
  })
})

function expectEntry(entry, msg, level, keys) {
  expect(entry.hostname).equal('my-host')
  expect(entry.name).equal('my-logger')
  expect(entry.pid).equal(process.pid)
  expect(entry.v).equal(0)
  expect(entry.level).equal(level)
  expect(entry.msg).equal(msg)
  expect(Object.keys(entry).sort()).deep.equal(keys || DEFAULT_KEYS)
}
