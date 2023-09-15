/*
 * Copyright 2023 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const traceHasHadCompletions = Symbol('TraceHasHadCompletions')
const ingestSource = 'NodeAgent'
const messageEvent = 'LlmChatCompletionMessage'
const summaryEvent = 'LlmChatCompletionSummary'
const transactionBeginEvent = 'LlmTransactionBegin'

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

        recordEvent(
          transactionBeginEvent,
          {
            human_prompt: humanMessage.content
          },
          segment
        )
      }
      const options = arguments[0]

      const messages = options.messages
      messages.forEach((message, i) => {
        recordEvent(
          messageEvent,
          {
            content: message.content,
            function_call: message.function_call?.name,
            role: message.role,
            sequence: i,
            completion_id: segment.id
          },
          segment
        )
      })

      let completionSummary = {
        model: options.model,
        number_of_messages: options.messages.length,
        id: segment.id
      }

      shim.bindPromise(resPromise, segment)
      resPromise.then((completion) => {
        const firstChoice = completion?.choices?.[0]
        if (firstChoice) {
          recordEvent(
            messageEvent,
            {
              content: firstChoice.message?.content,
              function_call: firstChoice.message?.function_call?.name,
              role: firstChoice.message?.role,
              sequence: messages.length,
              vendor: 'openAI',
              completion_id: segment.id,
              is_final_response: true
            },
            segment
          )
        }
        completionSummary.response =
          firstChoice?.message?.content ?? firstChoice?.message?.function_call?.name
        completionSummary.finish_reason = firstChoice?.finish_reason
        if (completion.usage) {
          completionSummary = {
            ...completionSummary,
            'usage.completion_tokens': completion.usage.completion_tokens,
            'usage.prompt_tokens': completion.usage.prompt_tokens,
            'usage.total_tokens': completion.usage.total_tokens
          }
        }
        recordEvent(summaryEvent, completionSummary, segment)
      })
      return resPromise
    }
  })

  function recordEvent(eventType, fields, segment) {
    agent.customEventAggregator.add(
      [
        { timestamp: Date.now(), type: eventType },
        {
          ...fields,
          'vendor': 'openAI',
          'trace.id': segment.transaction.traceId,
          'transactionId': segment.transaction.id,
          'ingest_source': ingestSource
        }
      ],
      Math.random()
    )
  }
}
