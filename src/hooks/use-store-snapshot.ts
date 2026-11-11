import { useSyncExternalStore } from "react"

/**
 * @hooks 订阅外部控制器的稳定快照，用于课程和考试状态共享
 * @param subscribe 控制器订阅函数
 * @param getSnapshot 返回当前不可变快照
 */
export function useStoreSnapshot<T>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => T
): T {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
