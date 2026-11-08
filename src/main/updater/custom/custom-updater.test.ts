import { describe, expect, it } from 'vitest'
import { parseCustomUpdateLine, parseCustomUpdaterConfig } from './custom-updater'

describe('parseCustomUpdaterConfig', () => {
  it('accepts absolute command and appImage with optional args and cwd', () => {
    expect(
      parseCustomUpdaterConfig(
        JSON.stringify({
          command: '/home/u/.local/bin/orca-custom-update',
          appImage: '/home/u/Applications/Orca.AppImage',
          args: ['--quiet'],
          cwd: '/home/u'
        })
      )
    ).toEqual({
      command: '/home/u/.local/bin/orca-custom-update',
      appImage: '/home/u/Applications/Orca.AppImage',
      args: ['--quiet'],
      cwd: '/home/u'
    })
  })

  it('rejects relative paths, bad args and invalid JSON', () => {
    expect(parseCustomUpdaterConfig('{')).toBeNull()
    expect(parseCustomUpdaterConfig(JSON.stringify({ command: 'orca-custom-update' }))).toBeNull()
    expect(
      parseCustomUpdaterConfig(JSON.stringify({ command: '/bin/x', appImage: 'Orca.AppImage' }))
    ).toBeNull()
    expect(
      parseCustomUpdaterConfig(JSON.stringify({ command: '/bin/x', appImage: '/a', args: 'x' }))
    ).toBeNull()
  })
})

describe('parseCustomUpdateLine', () => {
  it('reads progress lines and clamps the percent', () => {
    expect(parseCustomUpdateLine('{"percent":42,"step":"build"}')).toEqual({
      progress: { percent: 42, step: 'build' }
    })
    expect(parseCustomUpdateLine('{"percent":140}')).toEqual({ progress: { percent: 100 } })
  })

  it('reads result lines and ignores plain log output', () => {
    expect(
      parseCustomUpdateLine('{"result":"failed","runDir":"/r","error":"merge conflict"}')
    ).toEqual({
      result: { result: 'failed', runDir: '/r', error: 'merge conflict' }
    })
    expect(parseCustomUpdateLine('[orca-custom-update] merging v1.4.253')).toBeNull()
    expect(parseCustomUpdateLine('{"other":true}')).toBeNull()
  })
})
