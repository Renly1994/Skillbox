import { useEffect, useRef } from "react"
import wechatQr from "../assets/support-wechat-original.jpg"
import alipayQr from "../assets/support-alipay-original.jpg"
import "./support-author.css"

const OPEN_SUPPORT_DIALOG = "skillbox:open-support-dialog"

function CoffeeIcon() {
  return (
    <svg className="skillbox-support-cup" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="skillbox-support-cup__body">
        <path d="M4.3 7.2h11.5v6a5.1 5.1 0 0 1-5.1 5.1H9.4a5.1 5.1 0 0 1-5.1-5.1v-6Z" />
        <path d="M15.8 8.7h1.5a2.65 2.65 0 0 1 0 5.3h-1.6" />
        <path className="skillbox-support-cup__heart" d="M10.05 11.35c-.6-.82-1.5-1.04-2.15-.52-.75.6-.67 1.56.03 2.23l2.12 2.02 2.12-2.02c.7-.67.78-1.63.03-2.23-.65-.52-1.55-.3-2.15.52Z" />
      </g>
      <path d="M3.1 20.2h15.6" />
    </svg>
  )
}

export function SupportAuthorButton() {
  return (
    <button type="button" className="skillbox-support-button" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SUPPORT_DIALOG))}>
      <svg className="skillbox-support-heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
      <span>支持作者</span>
      <CoffeeIcon />
    </button>
  )
}

export function SupportAuthorDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const open = () => {
      if (!dialogRef.current?.open) dialogRef.current?.showModal()
    }
    window.addEventListener(OPEN_SUPPORT_DIALOG, open)
    return () => window.removeEventListener(OPEN_SUPPORT_DIALOG, open)
  }, [])

  return (
    <dialog ref={dialogRef} className="skillbox-support-dialog" aria-labelledby="skillbox-support-title" aria-describedby="skillbox-support-copy" onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === "Tab") {
        event.preventDefault()
        dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
      }
    }} onClick={(event) => {
      if (event.target === event.currentTarget) dialogRef.current?.close()
    }}>
      <article className="skillbox-support-dialog__content">
        <button type="button" className="skillbox-support-dialog__close" aria-label="关闭支持作者" onClick={() => dialogRef.current?.close()}>×</button>
        <header className="skillbox-support-dialog__header">
          <span className="skillbox-support-dialog__icon"><CoffeeIcon /></span>
          <div><p>开源工具 · 为爱发电中</p><h2 id="skillbox-support-title">支持作者小唐维护</h2></div>
        </header>
        <div id="skillbox-support-copy" className="skillbox-support-dialog__copy">
          <p>Skillbox 是我在工作和带娃之余，一点点做出来的开源工具。修 Bug、适配新 Agent、继续更新，偶尔也会忙到深夜。</p>
          <p><strong>如果它曾帮你省下一点折腾，欢迎请小唐喝杯咖啡。</strong>你的支持，会让我更有动力把它做得更好。</p>
        </div>
        <div className="skillbox-support-payments">
          <section className="skillbox-support-payment is-wechat">
            <h3>微信支付</h3>
            <div className="skillbox-support-qr"><img src={wechatQr} alt="小唐的微信收款二维码" draggable={false} /></div>
            <p>打开微信扫一扫</p>
          </section>
          <section className="skillbox-support-payment is-alipay">
            <h3>支付宝</h3>
            <div className="skillbox-support-qr"><img src={alipayQr} alt="小唐的支付宝收款二维码" draggable={false} /></div>
            <p>打开支付宝扫一扫</p>
          </section>
        </div>
        <p className="skillbox-support-dialog__footer">完全自愿<span>·</span>感谢每一份支持<span>·</span>不影响功能使用</p>
      </article>
    </dialog>
  )
}
