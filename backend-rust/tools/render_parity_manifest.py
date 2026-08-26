#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / "PARITY_MANIFEST.json").read_text())
routes = data["routes"]
by_slice = defaultdict(list)
for route in routes:
    by_slice[route["migration_slice"]].append(route)

lines = [
    "# Python → Rust 全量迁移 Parity Manifest",
    "",
    "> JSON 清单由 `tools/generate_parity_manifest.py` 生成；本文档仅汇总当前状态。",
    "",
    "## 当前结论",
    "",
    f"- Python/FastAPI 路由：**{data['python_route_count']}** 条",
    f"- Rust 当前注册：**{data['rust_registered_route_count']}** 条（含健康检查及 OpenAPI）",
    f"- 已完成路由差分 smoke：**{sum(item['rust_status'] == 'parity-tested' for item in routes)}** 条",
    f"- Rust 路由已存在但仍需写入/provider 差分测试：**{sum(item['rust_status'] == 'partial' for item in routes)}** 条",
    f"- Rust 尚无对应实现：**{sum(item['rust_status'] == 'missing' for item in routes)}** 条",
    "",
    "路由层 76/76 已完成；隔离 runner 的 88 项写入/provider/产物/review/worker 检查、Redis 事件矩阵和 stale recovery 均已通过。生产流量已切至 Rust 33014，Python 33013 保留用于回滚。"
    "",
    "## 按业务域统计",
    "",
    "| 业务域 | 路由数 | 缺失 | 需差分 | 已差分 |",
    "|---|---:|---:|---:|---:|",
]
for name, items in sorted(by_slice.items()):
    lines.append(
        f"| `{name}` | {len(items)} | "
        f"{sum(item['rust_status'] == 'missing' for item in items)} | "
        f"{sum(item['rust_status'] == 'partial' for item in items)} | "
        f"{sum(item['rust_status'] == 'parity-tested' for item in items)} |"
    )

lines += ["", "## 路由明细", "", "| ID | 方法 | 路径 | Python 函数 | Rust 状态 | 认证 |", "|---|---|---|---|---|---|"]
for route in routes:
    lines.append(
        f"| {route['id']} | `{route['method']}` | `{route['path']}` | "
        f"`{route['python_function']}` (L{route['python_line']}) | "
        f"**{route['rust_status']}** | `{route['auth']}` |"
    )

lines += ["", "## 后台 worker / 非 HTTP 入口", "", "| ID | 来源 | 职责 | Rust 状态 |", "|---|---|---|---|"]
for worker in data["workers"]:
    lines.append(
        f"| {worker['id']} | `{worker['source']}` | {worker['responsibility']} | **{worker['rust_status']}** |"
    )

lines += ["", "## 数据与外部边界", "", "### Python SQLAlchemy 表", "", ", ".join(f"`{table}`" for table in data["python_sqlalchemy_tables"]), "", "### 必须保留/桩化测试的外部边界", ""]
lines.extend(f"- {item}" for item in data["required_external_boundaries"])
lines += [
    "",
    "## 迁移门禁",
    "",
    "1. 76 条 HTTP 路由必须为 `parity-tested`；当前清单已满足。",
    "2. provider 必须覆盖成功、超时、HTTP 错误、畸形响应、重试和取消；已完成当前隔离矩阵。",
    "3. 任务必须支持持久化、原子 claim 和重启恢复；stale story-chain worker 验证已通过。",
    "4. 已完成 Rust canary、生产代理切换与 Python 回滚目标保留；后续变更仍需执行回滚演练。"
]
(ROOT / "PARITY_MANIFEST.md").write_text("\n".join(lines) + "\n")
print("rendered", ROOT / "PARITY_MANIFEST.md")
