import AssistantShell from "@/components/base/AssistantShell"
import cssText from "data-text:~style.css"
import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://hbnun.lsedu.vip/*"],
  run_at: "document_idle",
  all_frames: false
}

/**
 * @function 把 Tailwind CSS 注入 Plasmo Shadow DOM，并隔离页面的根字号
 * @return 已完成 rem 转 px 的样式节点
 */
export function getStyle(): HTMLStyleElement {
  const baseFontSize = 16
  let updatedCss = cssText.replaceAll(":root", ":host(plasmo-csui)")
  updatedCss = updatedCss.replace(
    /([\d.]+)rem/g,
    (_match, remValue: string) =>
      `${Number.parseFloat(remValue) * baseFontSize}px`
  )
  const style = document.createElement("style")
  style.textContent = updatedCss
  return style
}

export default AssistantShell
