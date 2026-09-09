"""Native launcher; the dashboard uses the POPUCOM web UI."""
import functools
import json
import queue
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(ROOT))
from monitor.runner import main, run

HOME = Path.home() / ".tibo-reset"
HOME.mkdir(exist_ok=True)
SITE = Path(sys._MEIPASS) / "site" if getattr(sys, "frozen", False) else ROOT / "dist"


def launch():
    import tkinter as tk
    from tkinter import ttk
    from tkinter.scrolledtext import ScrolledText
    from tkinter.filedialog import askopenfilename
    app = tk.Tk()
    app.title("Tibo 观察站 · 本地监控")
    app.geometry("610x425")
    status = tk.StringVar(value="本地模式 · 每 15 分钟检查 · 默认不发邮件")
    config = tk.StringVar(value=str(HOME / "monitor.config.json"))
    running = False
    messages = queue.SimpleQueue()
    frame = ttk.Frame(app, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Tibo 观察站", font=("", 24, "bold")).pack(anchor="w")
    ttk.Label(frame, textvariable=status, wraplength=540).pack(anchor="w", pady=10)
    ttk.Label(frame, text="配置文件（可先留空，直接使用公开 RSS）").pack(anchor="w")
    ttk.Entry(frame, textvariable=config).pack(fill="x", pady=5)
    controls = ttk.Frame(frame)
    controls.pack(fill="x", pady=10)
    log = ScrolledText(frame, height=7, wrap="word", state="disabled")
    log.pack(fill="both", expand=True)

    def display(message):
        status.set(message)
        log.configure(state="normal")
        log.insert("end", message + "\n")
        log.see("end")
        log.configure(state="disabled")

    def report(message):
        nonlocal running
        running = False
        display(message)

    def check():
        nonlocal running
        if running:
            return
        running = True
        status.set("正在检查公开 RSS…")
        selected_config = config.get()
        def worker():
            try:
                result = run(selected_config, HOME / "state.sqlite3", HOME / "data")
                if result["status"] == "cooldown":
                    message = "已完成本轮检查，15 分钟间隔内不会重复请求来源。"
                elif result["status"] == "source-unavailable":
                    message = "公开来源暂时不可用。保留历史数据，本轮不会发送邮件。"
                else:
                    delivery = {
                        "below-threshold": "暂无达到提醒线的新消息",
                        "draft-only": "已生成提醒草稿，未发送邮件",
                        "submitted": "已提交邮件，请在 MailerLite 查看投递结果",
                        "bootstrap-suppressed": "首次建立历史基线，不补发旧消息",
                        "needs-review": "上次发送结果需核查，本次不会重发",
                    }.get(result.get("notification"), "此事件已有发送记录，不重复提醒")
                    message = f'已读取 {result["posts"]} 条动态 · {delivery}。'
            except Exception as exc:
                message = "检查失败：" + type(exc).__name__ + "。请检查配置；没有自动重试发送。"
            messages.put(message)
        threading.Thread(target=worker, daemon=True).start()

    def browse_config():
        selected = askopenfilename(filetypes=[("JSON 配置", "*.json")])
        if selected:
            config.set(selected)

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path in ("/data/snapshot.json", "/data/health.json"):
                target = HOME / path.lstrip("/")
                if not target.exists():
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(target.read_bytes())
                return
            if path == "/config.json":
                public = HOME / "web.config.json"
                data = json.loads(public.read_text()) if public.exists() else {"subscriptionUrl": ""}
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"subscriptionUrl": data.get("subscriptionUrl", "")}).encode())
                return
            super().do_GET()
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(SITE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    dashboard_url = f"http://127.0.0.1:{server.server_port}/"
    def dashboard():
        if not (SITE / "index.html").exists():
            display("尚未构建网页。源码运行请先执行 npm ci && npm run build。")
            return
        try:
            opened = webbrowser.open(dashboard_url)
        except Exception:
            opened = False
        display("已请求系统浏览器打开。若未出现页面，可复制下方本机网址。" if opened
                else "未能自动打开浏览器。请复制下方本机网址，在浏览器中打开。")
    ttk.Button(controls, text="立即检查", command=check).pack(side="left")
    ttk.Button(controls, text="打开观察站", command=dashboard).pack(side="left", padx=8)
    ttk.Button(controls, text="选择配置", command=browse_config).pack(side="left")
    address = ttk.Frame(frame)
    address.pack(fill="x", before=log, pady=(0, 10))
    ttk.Label(address, text="本机网址").pack(side="left", padx=(0, 8))
    address_value = tk.StringVar(value=dashboard_url)
    ttk.Entry(address, textvariable=address_value, state="readonly").pack(side="left", fill="x", expand=True)
    ttk.Label(frame, text="关闭窗口后停止轮询。后台唤醒请使用项目提供的系统定时脚本。", wraplength=540).pack(anchor="w", pady=8)
    def tick():
        check()
        app.after(15 * 60 * 1000, tick)
    def drain():
        while not messages.empty():
            report(messages.get_nowait())
        app.after(150, drain)
    app.after(150, drain)
    app.after(100, tick)
    app.mainloop()
    server.shutdown()


if __name__ == "__main__":
    if "--once" in sys.argv:
        args = sys.argv[1:]
        for name, value in [("--state", HOME / "state.sqlite3"), ("--output", HOME / "data"),
                            ("--config", HOME / "monitor.config.json")]:
            if name not in args:
                args += [name, str(value)]
        raise SystemExit(main(args))
    launch()
