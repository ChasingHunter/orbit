import { contextBridge, ipcRenderer } from 'electron'
import type { BarEvent, OrbitApi } from '@shared/types'

const api: OrbitApi = {
  onEvent: (cb) => {
    const fn = (_e: unknown, ev: BarEvent): void => cb(ev)
    ipcRenderer.on('bar:event', fn)
    return () => ipcRenderer.off('bar:event', fn)
  },
  submit: (text, context) => ipcRenderer.invoke('bar:submit', text, context),
  cancel: () => ipcRenderer.send('bar:cancel'),
  newChat: () => ipcRenderer.send('bar:new'),
  approve: (id, approved) => ipcRenderer.send('bar:approve', id, approved),
  toggleVoice: () => ipcRenderer.send('bar:voice-toggle'),
  voiceEnded: () => ipcRenderer.send('bar:voice-ended'),
  transcribe: (samples) => ipcRenderer.invoke('stt:transcribe', samples),
  hide: () => ipcRenderer.send('bar:hide'),
  copy: (text) => ipcRenderer.send('bar:copy', text),
  replaceSelection: (text) => ipcRenderer.invoke('bar:replace', text),
  requestScreenshot: () => ipcRenderer.send('bar:screenshot'),
  resize: (height) => ipcRenderer.send('bar:resize', height),
  snipDone: (rect) => ipcRenderer.send('snip:done', rect),
  onSnipImage: (cb) => {
    ipcRenderer.on('snip:image', (_e, dataUrl: string) => cb(dataUrl))
  }
}

contextBridge.exposeInMainWorld('orbit', api)
