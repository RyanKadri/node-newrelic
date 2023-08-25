/*
 * Copyright 2023 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const indexNameRegex = /^https:\/\/(.*?)-(\d+)\.svc\..*?\.pinecone\.io$/

module.exports = function initialize(agent, pinecone, _moduleName, shim) {
  const clientProto = pinecone?.PineconeClient?.prototype

  if (!clientProto) {
    return false
  }

  shim.setDatastore(shim.PINECONE)

  if (clientProto.init) {
    shim.recordOperation(clientProto, ['init'], {
      promise: true,
      name: 'PineconeConnect',
      internal: true
    })
  }

  if (clientProto.Index) {
    shim.wrapReturn(clientProto, 'Index', function doWrap(shim, original, name, index) {
      wrapIndex(index)
    })
  }

  function wrapIndex(index) {
    shim.recordOperation(index, 'query', function wrapQuery(shim, _, __, args) {
      const [options] = args
      const { queryRequest } = options
      const indexNameMatch = this.configuration.basePath.match(indexNameRegex)

      return {
        name: 'Query',
        parameters: {
          host: this.configuration.basePath,
          database_name: indexNameMatch[1],
          topK: queryRequest.topK,
          includeMetadata: queryRequest.includeMetadata
        },
        promise: true,
        internal: true
      }
    })

    // TODO - This is some hacky nonsense to get everything showing up on one span. Is there a better way?
    shim.wrapReturn(index, 'query', function wrapQueryReturn(_, __, ___, res) {
      shim.interceptPromise(res, (resolvedVal) => {
        if (resolvedVal?.matches?.length > 0 && resolvedVal.matches[0].score) {
          let segment = shim.getActiveSegment()
          const targetName = 'Datastore/operation/Pinecone/Query'
          if (segment.name !== targetName) {
            segment = segment.getChildren().find((child) => child.name === targetName)
          }
          if (segment.name === targetName) {
            shim.getActiveSegment().addSpanAttribute('topScore', resolvedVal.matches[0].score)
            shim
              .getActiveSegment()
              .addSpanAttribute(
                'bottomScore',
                resolvedVal.matches[resolvedVal.matches.length - 1].score
              )
          }
        }
      })
    })
  }
}
