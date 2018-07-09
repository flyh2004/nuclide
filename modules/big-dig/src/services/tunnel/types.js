/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow strict
 * @format
 */

export type TunnelMessage = {
  event:
    | 'proxyCreated'
    | 'proxyClosed'
    | 'proxyError'
    | 'data'
    | 'timeout'
    | 'error'
    | 'end'
    | 'close'
    | 'connection',
  tunnelId?: string,
  clientId?: number,
  arg?: string,
  port?: number,
  remotePort?: number,
};
