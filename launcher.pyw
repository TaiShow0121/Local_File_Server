from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
import tkinter as tk
from tkinter import messagebox


APP_DIR = Path(__file__).resolve().parent
APP_FILE = APP_DIR / "app.py"
SETTINGS_FILE = APP_DIR / ".state" / "app_settings.json"
DEFAULT_PORT = 5000


class LanDriveLauncher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("LAN Drive Pro")
        self.geometry("460x330")
        self.minsize(420, 300)
        self.configure(bg="#eef3f6")
        self.process: subprocess.Popen | None = None
        self.port_var = tk.StringVar(value=str(self.read_port()))
        self.status_var = tk.StringVar(value="停止中")
        self.url_var = tk.StringVar(value=self.local_url())
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.build_ui()
        self.refresh_status()

    def read_port(self) -> int:
        try:
            with SETTINGS_FILE.open("r", encoding="utf-8") as f:
                settings = json.load(f)
            port = int(settings.get("server_port") or DEFAULT_PORT)
            return max(1024, min(65535, port))
        except Exception:
            return DEFAULT_PORT

    def local_url(self, path: str = "/") -> str:
        port = self.port_var.get().strip() or str(DEFAULT_PORT)
        if not path.startswith("/"):
            path = "/" + path
        return f"http://127.0.0.1:{port}{path}"

    def lan_url(self, path: str = "/") -> str:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                ip = s.getsockname()[0]
        except Exception:
            ip = "127.0.0.1"
        port = self.port_var.get().strip() or str(DEFAULT_PORT)
        if not path.startswith("/"):
            path = "/" + path
        return f"http://{ip}:{port}{path}"

    def is_port_open(self) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", int(self.port_var.get())), timeout=0.25):
                return True
        except Exception:
            return False

    def find_python_command(self) -> list[str]:
        if not getattr(sys, "frozen", False):
            return [sys.executable]
        python = shutil.which("python") or shutil.which("python3")
        if python:
            return [python]
        py = shutil.which("py")
        if py:
            return [py, "-3"]
        return []

    def build_ui(self):
        header = tk.Frame(self, bg="#eef3f6")
        header.pack(fill="x", padx=22, pady=(22, 12))

        logo = tk.Label(
            header,
            text="LD",
            width=4,
            height=2,
            fg="white",
            bg="#0f766e",
            font=("Segoe UI", 14, "bold"),
        )
        logo.pack(side="left")

        title_box = tk.Frame(header, bg="#eef3f6")
        title_box.pack(side="left", padx=12)
        tk.Label(title_box, text="LAN Drive Pro", bg="#eef3f6", fg="#0f172a", font=("Segoe UI", 18, "bold")).pack(anchor="w")
        tk.Label(title_box, text="Local file sharing launcher", bg="#eef3f6", fg="#64748b", font=("Segoe UI", 9, "bold")).pack(anchor="w")

        card = tk.Frame(self, bg="white", highlightthickness=1, highlightbackground="#dbe3ea")
        card.pack(fill="both", expand=True, padx=22, pady=8)

        tk.Label(card, textvariable=self.status_var, bg="white", fg="#0f766e", font=("Segoe UI", 13, "bold")).pack(anchor="w", padx=18, pady=(18, 4))
        tk.Label(card, textvariable=self.url_var, bg="white", fg="#64748b", font=("Segoe UI", 10), wraplength=390, justify="left").pack(anchor="w", padx=18)

        row = tk.Frame(card, bg="white")
        row.pack(fill="x", padx=18, pady=14)
        tk.Label(row, text="Port", bg="white", fg="#334155", font=("Segoe UI", 10, "bold")).pack(side="left")
        port_entry = tk.Entry(row, textvariable=self.port_var, width=8, font=("Segoe UI", 10))
        port_entry.pack(side="left", padx=8)
        port_entry.bind("<FocusOut>", lambda _event: self.url_var.set(self.local_url()))

        actions = tk.Frame(card, bg="white")
        actions.pack(fill="x", padx=18, pady=(2, 10))
        self.start_btn = tk.Button(actions, text="開始", command=self.start_server, bg="#0f766e", fg="white", bd=0, padx=18, pady=10, font=("Segoe UI", 10, "bold"))
        self.start_btn.pack(side="left", padx=(0, 8))
        tk.Button(actions, text="ブラウザで開く", command=lambda: webbrowser.open(self.local_url()), bg="#e2e8f0", fg="#0f172a", bd=0, padx=14, pady=10, font=("Segoe UI", 10, "bold")).pack(side="left", padx=(0, 8))
        tk.Button(actions, text="受け取り", command=lambda: webbrowser.open(self.local_url("/receive")), bg="#e2e8f0", fg="#0f172a", bd=0, padx=14, pady=10, font=("Segoe UI", 10, "bold")).pack(side="left")

        tk.Button(card, text="LAN URLをコピー", command=self.copy_lan_url, bg="#f1f5f9", fg="#0f172a", bd=0, padx=14, pady=9, font=("Segoe UI", 10, "bold")).pack(anchor="w", padx=18, pady=(0, 18))

    def start_server(self):
        if self.is_port_open():
            self.status_var.set("起動中")
            self.url_var.set(self.local_url())
            webbrowser.open(self.local_url())
            return
        cmd = self.find_python_command()
        if not cmd:
            messagebox.showerror("Pythonが見つかりません", "Pythonをインストールするか、server.batから起動してください。")
            return
        if not APP_FILE.exists():
            messagebox.showerror("app.pyが見つかりません", str(APP_FILE))
            return

        env = os.environ.copy()
        env["LAN_DRIVE_DEBUG"] = "0"
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            cmd + [str(APP_FILE)],
            cwd=str(APP_DIR),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=flags,
        )
        self.status_var.set("起動中...")
        self.start_btn.configure(state="disabled")
        threading.Thread(target=self.wait_until_ready, daemon=True).start()

    def wait_until_ready(self):
        for _ in range(60):
            if self.is_port_open():
                self.after(0, lambda: self.status_var.set("起動中"))
                self.after(0, lambda: self.start_btn.configure(state="normal", text="起動済み"))
                self.after(0, lambda: self.url_var.set(self.local_url()))
                self.after(0, lambda: webbrowser.open(self.local_url()))
                return
            time.sleep(0.25)
        self.after(0, lambda: self.status_var.set("起動確認に失敗"))
        self.after(0, lambda: self.start_btn.configure(state="normal"))

    def refresh_status(self):
        if self.is_port_open():
            self.status_var.set("起動中")
            self.start_btn.configure(text="起動済み")
        else:
            self.status_var.set("停止中")
            self.start_btn.configure(text="開始")
        self.url_var.set(self.local_url())
        self.after(3000, self.refresh_status)

    def copy_lan_url(self):
        url = self.lan_url()
        self.clipboard_clear()
        self.clipboard_append(url)
        self.status_var.set("LAN URLをコピーしました")
        self.url_var.set(url)

    def on_close(self):
        if self.process and self.process.poll() is None:
            if messagebox.askyesno("終了", "ランチャーから起動したサーバーも停止しますか？"):
                self.process.terminate()
        self.destroy()


if __name__ == "__main__":
    LanDriveLauncher().mainloop()
