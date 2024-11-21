/*
 * Copyright 2024 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

function stringifyClaudeChunkedMessage(chunks) {
  const stringifiedChunks = chunks.map((msgContent) => {
    switch (msgContent.type) {
      case 'text':
        return msgContent.text
      case 'image':
        return '<image>'
      case 'tool_use':
        return `<tool_use>${msgContent.name}</tool_use>`
      case 'tool_result':
        return `<tool_result>${msgContent.content}</tool_result>`
      default:
        return ''
    }
  })
  return stringifiedChunks.join('\n\n')
}

function stringifyConverseChunkedMessage(chunks) {
  const stringifiedChunks = chunks.map((chunk) => {
    if ('text' in chunk) {
      return chunk.text
    } else if ('image' in chunk) {
      return '<image>'
    } else if ('document' in chunk) {
      return `<document>${chunk.document.name ?? ''}</document>`
    } else if ('toolUse' in chunk) {
      return `<tool_use>${chunk.toolUse?.name ?? ''}</tool_use>`
    } else if ('toolResult' in chunk) {
      return `<tool_result>${chunk.toolResult.content
        .map((toolChunk) => toolChunk.text ?? '')
        .join('\n\n')}</tool_result>`
    } else if ('guardContent' in chunk) {
      return `<guard_content>${chunk.guardContent?.text ?? ''}</guard_content`
    }
    return '<unknown_chunk />'
  })
  return stringifiedChunks.join('\n\n')
}

module.exports = {
  stringifyClaudeChunkedMessage,
  stringifyConverseChunkedMessage
}
