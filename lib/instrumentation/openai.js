/*
 * Copyright 2023 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const traceHasHadCompletions = Symbol('TraceHasHadCompletions')
const ingestSource = 'NodeAgent'

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
          shim.getActiveSegment().addSpanAttribute('model', args[0].model)
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
      const transaction = segment.transaction

      if (!transaction[traceHasHadCompletions]) {
        transaction[traceHasHadCompletions] = true

        const messages = arguments[0].messages
        const humanMessage = messages.find((message) => message.role === 'user')

        agent.customEventAggregator.add([
          { timestamp: Date.now(), type: 'LlmTransactionBegin' },
          {
            'human_prompt': humanMessage.content,
            'vendor': 'openAI',
            'trace.id': segment.transaction.id,
            'ingest_source': ingestSource
          }
        ])
      }
      const options = arguments[0]

      const messages = options.messages
      messages.forEach((message, i) => {
        agent.customEventAggregator.add(
          [
            { timestamp: Date.now(), type: 'LlmChatCompletionMessage' },
            {
              'content': message.content,
              'role': message.role,
              'sequence': i,
              'vendor': 'openAI',
              'trace.id': segment.transaction.id,
              'ingest_source': ingestSource,
              'completion_id': segment.id
            }
          ],
          Math.random()
        )
      })

      segment.addSpanAttribute('vendor', 'openAI')
      segment.addSpanAttribute('model', options.model)
      segment.addSpanAttribute('number_of_messages', options.messages.length)
      segment.addSpanAttribute('ingest_source', ingestSource)
      shim.bindPromise(resPromise, segment)
      resPromise.then((completion) => {
        const firstChoice = completion?.choices?.[0]
        if (firstChoice) {
          segment.addSpanAttribute('response', firstChoice?.message)
          segment.addSpanAttribute('finish_reason', firstChoice?.finish_reason)
        }
        if (completion.usage) {
          segment.addSpanAttribute('usage.completion_tokens', completion.usage.completion_tokens)
          segment.addSpanAttribute('usage.prompt_tokens', completion.usage.prompt_tokens)
          segment.addSpanAttribute('usage.total_tokens', completion.usage.total_tokens)
        }
      })
      return resPromise
    }
  })
}
