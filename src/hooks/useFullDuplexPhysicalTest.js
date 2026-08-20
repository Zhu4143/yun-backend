import { useMemo, useState } from 'react'
import { FullDuplexPhysicalTest } from '../voice/diagnostics/FullDuplexPhysicalTest.js'

export function useFullDuplexPhysicalTest({ manager }) {
  const [state, setState] = useState({ active: false, phase: 'idle', report: null })
  const test = useMemo(() => new FullDuplexPhysicalTest({ manager, onUpdate: setState }), [manager])
  return {
    ...state,
    start: (playTestSpeech) => test.run({ playTestSpeech }),
    download: () => test.download(state.report),
  }
}
