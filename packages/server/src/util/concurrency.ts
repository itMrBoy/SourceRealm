/** 并发生成关卡的默认上限;可用 SOURCEREALM_CONCURRENCY 覆盖 */
const DEFAULT_CONCURRENCY = 3

/** 读取并发上限:合法正整数生效,否则回落默认值 */
export function readConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SOURCEREALM_CONCURRENCY)
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_CONCURRENCY
}

/**
 * 受限并发执行:对 items 逐个调用 worker,同时进行的任务数不超过 limit。
 * 保持与输入同序返回结果;worker 内部自行 try/catch(调用方决定单项失败是否影响整体)。
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

/** 串行 mutex:把对共享状态的写入排队,避免并发覆盖。即使某次 fn 抛错也不打断队列。 */
export function createMutex(): (fn: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve()
  return (fn) => {
    const run = tail.then(fn)
    tail = run.catch(() => {})
    return run
  }
}
