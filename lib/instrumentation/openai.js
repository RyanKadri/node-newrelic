/*
 * Copyright 2023 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

module.exports = function initialize(agent, openai, _moduleName, shim) {
  const client = openai

  if (!client) {
    return false
  }

  shim.wrapClass(openai, ['OpenAI'], {
    post: function createClient(shim) {
      recordEmbeddings.call(this, shim, agent)
      recordChatCompletion.call(this, shim, agent)
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

function recordChatCompletion(shim, agent) {
  shim.wrap(this.chat.completions, ['create'], function recordCreateCompletion(shim, orig) {
    return function completionWrapper() {
      const segment = shim.createSegment({ name: 'AI/OpenAI/Chat/Completions/Create' })
      const resPromise = shim.applySegment(orig, segment, true, this, arguments)
      const options = arguments[0]

      const messages = options.messages
      messages.forEach((message, i) => {
        agent.customEventAggregator.add(
          [
            { timestamp: Date.now(), type: 'AgentLlmChatMessage' },
            {
              'content': message.content,
              'role': message.role,
              'sequence': i,
              'vendor': 'openAI',
              'trace.id': segment.transaction.id
            }
          ],
          Math.random()
        )
      })

      segment.addSpanAttribute('vendor', 'openAI')
      segment.addSpanAttribute('model', options.model)
      segment.addSpanAttribute('messagesCount', options.messages.length)
      shim.bindPromise(resPromise, segment)
      resPromise.then((completion) => {
        const firstChoice = completion?.choices?.[0]
        if (firstChoice) {
          segment.addSpanAttribute('response', firstChoice?.message)
          segment.addSpanAttribute('finishReason', firstChoice?.finish_reason)
        }
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
