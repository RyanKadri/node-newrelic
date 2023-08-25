/*
 * Copyright 2023 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

module.exports = function initialize(_agent, openai, _moduleName, shim) {
  const client = openai

  if (!client) {
    return false
  }

  shim.wrapClass(openai, ['OpenAI'], {
    post: function createClient(shim) {
      recordEmbeddings.call(this, shim)
      recordChatCompletion.call(this, shim, _agent)
    }
  })
}

function recordEmbeddings(shim) {
  shim.record(
    this.embeddings,
    ['create'],
    function recordCreateEmbedding(shim, _func, _name, args) {
      return {
        name: 'AI/OpenAI/Embeddings/Create',
        promise: true,
        internal: true,
        after: () => {
          shim.getActiveSegment().addSpanAttribute('model', args.model)
        }
      }
    }
  )
}

function recordChatCompletion(shim) {
  shim.wrap(this.chat.completions, ['create'], function recordCreateCompletion(shim, orig) {
    return function completionWrapper() {
      const segment = shim.createSegment({ name: 'AI/OpenAI/Chat/Completions/Create' })
      const resPromise = shim.applySegment(orig, segment, true, this, arguments)
      const options = arguments[0]
      segment.addSpanAttribute('model', options.model),
        segment.addSpanAttribute('messagesCount', options.messages.length)
      shim.bindPromise(resPromise, segment)
      resPromise.then((completion) => {
        if (completion.usage) {
          segment.addSpanAttribute('completionTokens', completion.usage.completion_tokens)
          segment.addSpanAttribute('promptTokens', completion.usage.prompt_tokens)
          segment.addSpanAttribute('totalTokens', completion.usage.total_tokens)
        }
      })
      return resPromise
    }
  })
}
