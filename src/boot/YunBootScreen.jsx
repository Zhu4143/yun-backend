import './YunBootScreen.css'

function currentTaskFor(state) {
  return state.tasks?.find((task) => task.status === 'running')
    || state.tasks?.find((task) => task.status === 'failed')
    || state.tasks?.find((task) => task.status === 'pending')
}

export function YunBootScreen({ state, onRetry }) {
  const progress = Math.round(state.progress || 0)
  const currentTask = currentTaskFor(state)
  const completeTasks = (state.tasks || []).filter((task) => task.status === 'success').slice(-4)
  const failedTasks = (state.tasks || []).filter((task) => task.status === 'failed')
  const isFailed = state.status === 'failed'

  return (
    <main className="yun-boot-shell" aria-live="polite">
      <div className="yun-boot-ambient" aria-hidden="true" />
      <section className={`yun-boot-card${isFailed ? ' is-failed' : ''}`}>
        <div className="yun-boot-mark" aria-label="昀 YUN">
          <strong>昀</strong>
          <span>YUN</span>
        </div>

        <p className="yun-boot-message">
          {isFailed ? '昀暂时没能完成启动' : '正在准备音乐…'}
        </p>

        {!isFailed && (
          <>
            <div className="yun-boot-progress-row">
              <span>启动自检</span>
              <strong>{progress}%</strong>
            </div>
            <div className="yun-boot-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="yun-boot-current">
              <span className="yun-boot-pulse" aria-hidden="true" />
              <div>
                <strong>{currentTask?.label || '整理启动状态'}</strong>
                {currentTask?.detail && <small>{currentTask.detail}</small>}
              </div>
            </div>
            <ul className="yun-boot-complete-list">
              {completeTasks.map((task) => <li key={task.id}>✓ {task.label}</li>)}
            </ul>
          </>
        )}

        {isFailed && (
          <div className="yun-boot-error">
            <ul>
              {failedTasks.map((task) => (
                <li key={task.id}>
                  <strong>{task.label}</strong>
                  <span>{task.error}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onRetry}>重新检查</button>
          </div>
        )}
      </section>
    </main>
  )
}
