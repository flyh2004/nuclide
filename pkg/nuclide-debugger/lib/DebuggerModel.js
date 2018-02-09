/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import type {DatatipService} from 'atom-ide-ui';
import type {DebuggerAction} from './DebuggerDispatcher';
import type {
  Callstack,
  DebuggerModeType,
  NuclideThreadData,
  ThreadItem,
} from './types';

import * as React from 'react';
import {DebuggerProviderStore} from './DebuggerProviderStore';
import BreakpointManager from './BreakpointManager';
import BreakpointStore from './BreakpointStore';
import DebuggerActions from './DebuggerActions';
import {DebuggerStore} from './DebuggerStore';
import {WatchExpressionStore} from './WatchExpressionStore';
import ScopesStore from './ScopesStore';
import {WatchExpressionListStore} from './WatchExpressionListStore';
import DebuggerActionsStore from './DebuggerActionsStore';
import Bridge from './Bridge';
import UniversalDisposable from 'nuclide-commons/UniversalDisposable';
import DebuggerDispatcher from './DebuggerDispatcher';
import {DebuggerPauseController} from './DebuggerPauseController';
import {Emitter} from 'atom';
import nuclideUri from 'nuclide-commons/nuclideUri';
import {ActionTypes} from './DebuggerDispatcher';
import debounce from 'nuclide-commons/debounce';
import {Icon} from 'nuclide-commons-ui/Icon';
import {DebuggerMode} from './constants';

import type {SerializedState} from '..';

export const WORKSPACE_VIEW_URI = 'atom://nuclide/debugger';
const CALLSTACK_CHANGE_EVENT = 'CALLSTACK_CHANGE_EVENT';
const THREADS_CHANGED_EVENT = 'THREADS_CHANGED_EVENT';

/**
 * Atom ViewProvider compatible model object.
 */
export default class DebuggerModel {
  _disposables: UniversalDisposable;
  _actions: DebuggerActions;
  _breakpointManager: BreakpointManager;
  _breakpointStore: BreakpointStore;
  _dispatcher: DebuggerDispatcher;
  _store: DebuggerStore;
  _watchExpressionStore: WatchExpressionStore;
  _watchExpressionListStore: WatchExpressionListStore;
  _debuggerProviderStore: DebuggerProviderStore;
  _debuggerActionStore: DebuggerActionsStore;
  _scopesStore: ScopesStore;
  _bridge: Bridge;
  _debuggerPauseController: DebuggerPauseController;
  _emitter: Emitter;
  _datatipService: ?DatatipService;
  _debuggerMode: DebuggerModeType;

  // CallStack state
  _callstack: ?Callstack;
  _selectedCallFrameIndex: number;
  _selectedCallFrameMarker: ?atom$Marker;

  // Threads state
  _threadMap: Map<number, ThreadItem>;
  _owningProcessId: number;
  _selectedThreadId: number;
  _stopThreadId: number;
  _threadChangeDatatip: ?IDisposable;
  _threadsReloading: boolean;

  constructor(state: ?SerializedState) {
    this._dispatcher = new DebuggerDispatcher();
    this._callstack = null;
    this._selectedCallFrameIndex = 0;
    this._selectedCallFrameMarker = null;
    this._emitter = new Emitter();
    this._datatipService = null;
    this._threadMap = new Map();
    this._owningProcessId = 0;
    this._selectedThreadId = 0;
    this._stopThreadId = 0;
    this._threadsReloading = false;
    this._debuggerMode = DebuggerMode.STOPPED;

    // Debounce calls to _openPathInEditor to work around an Atom bug that causes
    // two editor windows to be opened if multiple calls to atom.workspace.open
    // are made close together, even if {searchAllPanes: true} is set.
    (this: any)._openPathInEditor = debounce(this._openPathInEditor, 100, true);

    const pauseOnException = state != null ? state.pauseOnException : true;
    const pauseOnCaughtException =
      state != null ? state.pauseOnCaughtException : false;
    this._store = new DebuggerStore(
      this._dispatcher,
      this,
      pauseOnException,
      pauseOnCaughtException,
    );
    this._actions = new DebuggerActions(this._dispatcher, this._store);
    this._breakpointStore = new BreakpointStore(
      this._dispatcher,
      state != null ? state.breakpoints : null, // serialized breakpoints
      this._store,
    );
    this._breakpointManager = new BreakpointManager(
      this._breakpointStore,
      this._actions,
    );
    this._bridge = new Bridge(this);
    this._debuggerProviderStore = new DebuggerProviderStore(
      this._dispatcher,
      this._actions,
    );
    this._watchExpressionStore = new WatchExpressionStore(
      this._dispatcher,
      this._bridge,
    );
    this._watchExpressionListStore = new WatchExpressionListStore(
      this._watchExpressionStore,
      this._dispatcher,
      state != null ? state.watchExpressions : null, // serialized watch expressions
    );
    this._debuggerActionStore = new DebuggerActionsStore(
      this._dispatcher,
      this._bridge,
    );
    this._scopesStore = new ScopesStore(
      this._dispatcher,
      this._bridge,
      this._store,
    );
    this._debuggerPauseController = new DebuggerPauseController(this._store);
    const dispatcherToken = this._dispatcher.register(
      this._handlePayload.bind(this),
    );

    this._disposables = new UniversalDisposable(
      this._store,
      this._actions,
      this._breakpointStore,
      this._breakpointManager,
      this._bridge,
      this._debuggerProviderStore,
      this._watchExpressionStore,
      this._debuggerActionStore,
      this._scopesStore,
      this._debuggerPauseController,
      () => {
        this._dispatcher.unregister(dispatcherToken);
        this._clearSelectedCallFrameMarker();
        this._cleanUpDatatip();
      },
    );
  }

  dispose() {
    this._disposables.dispose();
  }

  getActions(): DebuggerActions {
    return this._actions;
  }

  getStore(): DebuggerStore {
    return this._store;
  }

  getWatchExpressionStore(): WatchExpressionStore {
    return this._watchExpressionStore;
  }

  getWatchExpressionListStore(): WatchExpressionListStore {
    return this._watchExpressionListStore;
  }

  getDebuggerProviderStore(): DebuggerProviderStore {
    return this._debuggerProviderStore;
  }

  getBreakpointStore(): BreakpointStore {
    return this._breakpointStore;
  }

  getScopesStore(): ScopesStore {
    return this._scopesStore;
  }

  getBridge(): Bridge {
    return this._bridge;
  }

  getTitle(): string {
    return 'Debugger';
  }

  getDefaultLocation(): string {
    return 'right';
  }

  getURI(): string {
    return WORKSPACE_VIEW_URI;
  }

  getPreferredWidth(): number {
    return 500;
  }

  selectThread(threadId: string): void {
    this._bridge.selectThread(threadId);
  }

  setSelectedCallFrameIndex(callFrameIndex: number): void {
    this._bridge.setSelectedCallFrameIndex(callFrameIndex);
    this._actions.setSelectedCallFrameIndex(callFrameIndex);
  }

  _handlePayload(payload: DebuggerAction): void {
    switch (payload.actionType) {
      case ActionTypes.CLEAR_INTERFACE:
        this._handleClearInterface();
        this._emitter.emit(THREADS_CHANGED_EVENT);
        break;
      case ActionTypes.SET_SELECTED_CALLFRAME_LINE:
        // TODO: update _selectedCallFrameIndex.
        this._setSelectedCallFrameLine(payload.data.options);
        break;
      case ActionTypes.OPEN_SOURCE_LOCATION:
        this._openSourceLocation(
          payload.data.sourceURL,
          payload.data.lineNumber,
        );
        break;
      case ActionTypes.UPDATE_CALLSTACK:
        this._updateCallstack(payload.data.callstack);
        break;
      case ActionTypes.SET_SELECTED_CALLFRAME_INDEX:
        this._updateSelectedCallFrameIndex(payload.data.index);
        break;
      case ActionTypes.UPDATE_THREADS:
        this._threadsReloading = false;
        this._updateThreads(payload.data.threadData);
        this._emitter.emit(THREADS_CHANGED_EVENT);
        break;
      case ActionTypes.UPDATE_THREAD:
        this._threadsReloading = false;
        this._updateThread(payload.data.thread);
        this._emitter.emit(THREADS_CHANGED_EVENT);
        break;
      case ActionTypes.UPDATE_STOP_THREAD:
        this._updateStopThread(payload.data.id);
        this._emitter.emit(THREADS_CHANGED_EVENT);
        break;
      case ActionTypes.UPDATE_SELECTED_THREAD:
        this._updateSelectedThread(payload.data.id);
        this._emitter.emit(THREADS_CHANGED_EVENT);
        break;
      case ActionTypes.NOTIFY_THREAD_SWITCH:
        this._notifyThreadSwitch(
          payload.data.sourceURL,
          payload.data.lineNumber,
          payload.data.message,
        );
        break;
      case ActionTypes.DEBUGGER_MODE_CHANGE:
        if (
          this._debuggerMode === DebuggerMode.RUNNING &&
          payload.data === DebuggerMode.PAUSED
        ) {
          // If the debugger just transitioned from running to paused, the debug server should
          // be sending updated thread stacks. This may take a moment.
          this._threadsReloading = true;
        } else if (payload.data === DebuggerMode.RUNNING) {
          // The UI is never waiting for threads if it's running.
          this._threadsReloading = false;
        }
        this._debuggerMode = payload.data;
        this._emitter.emit(THREADS_CHANGED_EVENT);
        break;
      default:
        return;
    }
  }

  _updateCallstack(callstack: Callstack): void {
    this._selectedCallFrameIndex = 0;
    this._callstack = callstack;
    this._emitter.emit(CALLSTACK_CHANGE_EVENT);
  }

  _updateSelectedCallFrameIndex(index: number): void {
    this._selectedCallFrameIndex = index;
    this._emitter.emit(CALLSTACK_CHANGE_EVENT);
  }

  _openSourceLocation(sourceURL: string, lineNumber: number): void {
    try {
      const path = nuclideUri.uriToNuclideUri(sourceURL);
      if (path != null && atom.workspace != null) {
        // only handle real files for now.
        // This should be goToLocation instead but since the searchAllPanes option is correctly
        // provided it's not urgent.
        this._openPathInEditor(path).then(editor => {
          this._nagivateToLocation(editor, lineNumber);
        });
      }
    } catch (e) {}
  }

  _openPathInEditor(path: string): Promise<atom$TextEditor> {
    // eslint-disable-next-line rulesdir/atom-apis
    return atom.workspace.open(path, {
      searchAllPanes: true,
      pending: true,
    });
  }

  _nagivateToLocation(editor: atom$TextEditor, line: number): void {
    editor.scrollToBufferPosition([line, 0]);
    editor.setCursorBufferPosition([line, 0]);
  }

  _handleClearInterface(): void {
    this._selectedCallFrameIndex = 0;
    this._setSelectedCallFrameLine(null);
    this._updateCallstack([]);

    this._threadMap.clear();
    this._cleanUpDatatip();
  }

  _setSelectedCallFrameLine(options: ?{sourceURL: string, lineNumber: number}) {
    if (options) {
      const path = nuclideUri.uriToNuclideUri(options.sourceURL);
      const {lineNumber} = options;
      if (path != null && atom.workspace != null) {
        // only handle real files for now
        // This should be goToLocation instead but since the searchAllPanes option is correctly
        // provided it's not urgent.
        this._openPathInEditor(path).then(editor => {
          this._clearSelectedCallFrameMarker();
          this._highlightCallFrameLine(editor, lineNumber);
          this._nagivateToLocation(editor, lineNumber);
        });
      }
    } else {
      this._clearSelectedCallFrameMarker();
    }
  }

  _highlightCallFrameLine(editor: atom$TextEditor, line: number) {
    const marker = editor.markBufferRange([[line, 0], [line, Infinity]], {
      invalidate: 'never',
    });
    editor.decorateMarker(marker, {
      type: 'line',
      class: 'nuclide-current-line-highlight',
    });
    this._selectedCallFrameMarker = marker;
  }

  _clearSelectedCallFrameMarker() {
    if (this._selectedCallFrameMarker) {
      this._selectedCallFrameMarker.destroy();
      this._selectedCallFrameMarker = null;
    }
  }

  onCallstackChange(callback: () => void): IDisposable {
    return this._emitter.on(CALLSTACK_CHANGE_EVENT, callback);
  }

  getCallstack(): ?Callstack {
    return this._callstack;
  }

  getSelectedCallFrameIndex(): number {
    return this._selectedCallFrameIndex;
  }

  setDatatipService(service: DatatipService) {
    this._datatipService = service;
  }

  _updateThreads(threadData: NuclideThreadData): void {
    this._threadMap.clear();
    this._owningProcessId = threadData.owningProcessId;
    if (
      !Number.isNaN(threadData.stopThreadId) &&
      threadData.stopThreadId >= 0
    ) {
      this._stopThreadId = threadData.stopThreadId;
      this._selectedThreadId = threadData.stopThreadId;
    }

    this._threadsReloading = false;
    threadData.threads.forEach(thread =>
      this._threadMap.set(Number(thread.id), thread),
    );
  }

  _updateThread(thread: ThreadItem): void {
    // TODO(jonaldislarry): add deleteThread API so that this stop reason checking is not needed.
    if (
      thread.stopReason === 'end' ||
      thread.stopReason === 'error' ||
      thread.stopReason === 'stopped'
    ) {
      this._threadMap.delete(Number(thread.id));
    } else {
      this._threadMap.set(Number(thread.id), thread);
    }
  }

  _updateStopThread(id: number) {
    this._stopThreadId = Number(id);
    this._selectedThreadId = Number(id);
  }

  _updateSelectedThread(id: number) {
    this._selectedThreadId = Number(id);
  }

  _cleanUpDatatip(): void {
    if (this._threadChangeDatatip) {
      if (this._datatipService != null) {
        this._threadChangeDatatip.dispose();
      }
      this._threadChangeDatatip = null;
    }
  }

  // TODO(dbonafilia): refactor this code along with the ui code in callstackStore to a ui controller.
  async _notifyThreadSwitch(
    sourceURL: string,
    lineNumber: number,
    message: string,
  ): Promise<void> {
    const path = nuclideUri.uriToNuclideUri(sourceURL);
    // we want to put the message one line above the current line unless the selected
    // line is the top line, in which case we will put the datatip next to the line.
    const notificationLineNumber = lineNumber === 0 ? 0 : lineNumber - 1;
    // only handle real files for now
    const datatipService = this._datatipService;
    if (datatipService != null && path != null && atom.workspace != null) {
      // This should be goToLocation instead but since the searchAllPanes option is correctly
      // provided it's not urgent.
      // eslint-disable-next-line rulesdir/atom-apis
      atom.workspace.open(path, {searchAllPanes: true}).then(editor => {
        const buffer = editor.getBuffer();
        const rowRange = buffer.rangeForRow(notificationLineNumber);
        this._threadChangeDatatip = datatipService.createPinnedDataTip(
          {
            component: this._createAlertComponentClass(message),
            range: rowRange,
            pinnable: true,
          },
          editor,
        );
      });
    }
  }

  getThreadList(): Array<ThreadItem> {
    return Array.from(this._threadMap.values());
  }

  getSelectedThreadId(): number {
    return this._selectedThreadId;
  }

  getThreadsReloading(): boolean {
    return this._threadsReloading;
  }

  getStopThread(): ?number {
    return this._stopThreadId;
  }

  onThreadsChanged(callback: () => void): IDisposable {
    return this._emitter.on(THREADS_CHANGED_EVENT, callback);
  }

  _createAlertComponentClass(message: string): React.ComponentType<any> {
    return () => (
      <div className="nuclide-debugger-thread-switch-alert">
        <Icon icon="alert" />
        {message}
      </div>
    );
  }
}
