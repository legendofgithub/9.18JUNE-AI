import asyncio
import json
import os
import shutil
import time
from pathlib import Path

from ..core.exceptions import ValidationException
from ..models.database import HarnessProjectModel, SessionModel, ToolCallModel
from ..repositories.harness_repo import HarnessRepository, normalize_relative_path


TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "列出当前项目沙箱中的文件，返回相对路径、大小和类型。",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取项目沙箱内的一个文本文件。",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "项目内相对路径"}},
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": "按文件名或文本内容搜索项目沙箱。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "minLength": 1}},
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "提出写入项目沙箱文件的变更；必须等待用户审批后才会落盘。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_memory",
            "description": "保存一条项目级长期记忆。",
            "parameters": {
                "type": "object",
                "properties": {
                    "memory_type": {"type": "string", "enum": ["preference", "summary", "fact", "lesson", "todo"]},
                    "content": {"type": "string"},
                },
                "required": ["content"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_document",
            "description": "在服务端生成一个 Markdown 项目文档。",
            "parameters": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "content": {"type": "string"}},
                "required": ["title", "content"],
                "additionalProperties": False,
            },
        },
    },
]

TOOL_PERMISSIONS = {
    "list_files": "read",
    "read_file": "read",
    "search_files": "read",
    "write_file": "write",
    "save_memory": "write",
    "create_document": "write",
}


class ToolRegistry:
    def __init__(self, repo: HarnessRepository, workspace_root: Path):
        self.repo = repo
        self.workspace_root = workspace_root.resolve()
        self.workspace_root.mkdir(parents=True, exist_ok=True)

    def definitions(self) -> list[dict]:
        return TOOL_DEFINITIONS

    def allowed(self, name: str, permission: str) -> bool:
        if name not in TOOL_PERMISSIONS:
            return False
        return TOOL_PERMISSIONS[name] == "read" or permission in {"workspace-write", "full-access"}

    def project_root(self, project: HarnessProjectModel) -> Path:
        root = (self.workspace_root / project.id).resolve()
        root.relative_to(self.workspace_root)
        root.mkdir(parents=True, exist_ok=True)
        return root

    def safe_file_target(self, project: HarnessProjectModel, path: str) -> tuple[Path, str]:
        relative = normalize_relative_path(path, allow_directory=False)
        root = self.project_root(project)
        target = (root / relative).resolve()
        target.relative_to(root)
        current = root
        for part in Path(relative).parts:
            current = current / part
            if current.is_symlink():
                raise ValidationException("拒绝访问符号链接路径")
        return target, relative

    def _pending_path(self, project: HarnessProjectModel, tool_call_id: str) -> Path:
        root = (self.workspace_root / "_pending" / project.id).resolve()
        root.relative_to(self.workspace_root)
        root.mkdir(parents=True, exist_ok=True)
        path = (root / f"{tool_call_id}.pending").resolve()
        path.relative_to(root)
        return path

    async def execute(
        self,
        name: str,
        arguments: dict,
        *,
        project: HarnessProjectModel,
        session: SessionModel,
        permission: str,
    ) -> dict:
        if not self.allowed(name, permission):
            raise ValidationException("当前权限不允许调用该工具")
        if name == "list_files":
            return await self._list_files(project)
        if name == "read_file":
            return await self._read_file(project, arguments)
        if name == "search_files":
            return await self._search_files(project, arguments)
        if name == "write_file":
            return self._propose_write(project, arguments)
        if name == "save_memory":
            return await self._save_memory(project, arguments)
        if name == "create_document":
            return await self._create_document(project, arguments)
        raise ValidationException("未知工具")

    async def _list_files(self, project: HarnessProjectModel) -> dict:
        files = self.repo.list_files(project.id)
        return {
            "files": [
                {"path": item.path, "name": item.name, "size": item.size, "mimeType": item.mime_type}
                for item in files[:500]
            ],
            "total": len(files),
        }

    async def _read_file(self, project: HarnessProjectModel, arguments: dict) -> dict:
        path = str(arguments.get("path") or "")
        item = self.repo.get_file_by_path(project.id, path)
        if item is None:
            raise ValidationException("文件不存在")
        if item.size > 2 * 1024 * 1024:
            raise ValidationException("文件超过单次读取限制")
        return {"path": item.path, "content": item.content}

    async def _search_files(self, project: HarnessProjectModel, arguments: dict) -> dict:
        query = str(arguments.get("query") or "").strip()
        if not query:
            raise ValidationException("搜索关键词不能为空")
        matches = []
        for item in self.repo.list_files(project.id):
            content_match = item.content.find(query)
            if query.lower() in item.path.lower() or content_match >= 0:
                start = max(0, content_match - 120)
                end = min(len(item.content), content_match + 360) if content_match >= 0 else min(len(item.content), 360)
                matches.append({
                    "path": item.path,
                    "snippet": item.content[start:end],
                })
            if len(matches) >= 20:
                break
        return {"query": query, "matches": matches}

    def _propose_write(self, project: HarnessProjectModel, arguments: dict) -> dict:
        path = str(arguments.get("path") or "")
        content = str(arguments.get("content") or "")
        if len(content.encode("utf-8")) > 10 * 1024 * 1024:
            raise ValidationException("写入内容超过 10MB 限制")
        target, relative = self.safe_file_target(project, path)
        return {
            "requiresApproval": True,
            "path": relative,
            "isNewFile": not target.exists(),
            "bytes": len(content.encode("utf-8")),
        }

    def prepare_write(self, project: HarnessProjectModel, tool_call_id: str, arguments: dict) -> None:
        content = str(arguments.get("content") or "")
        if len(content.encode("utf-8")) > 10 * 1024 * 1024:
            raise ValidationException("写入内容超过 10MB 限制")
        target = self._pending_path(project, tool_call_id)
        temporary = target.with_name(f".{target.name}.{os.urandom(6).hex()}.tmp")
        try:
            with temporary.open("w", encoding="utf-8", newline="") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if temporary.exists():
                temporary.unlink()

    async def _save_memory(self, project: HarnessProjectModel, arguments: dict) -> dict:
        memory_type = str(arguments.get("memory_type") or "fact")
        if memory_type not in {"preference", "summary", "fact", "lesson", "todo"}:
            memory_type = "fact"
        content = str(arguments.get("content") or "").strip()
        if not content:
            raise ValidationException("记忆内容不能为空")
        memory = self.repo.add_memory(project, memory_type, content[:10000])
        return {"id": memory.id, "memoryType": memory.memory_type}

    async def _create_document(self, project: HarnessProjectModel, arguments: dict) -> dict:
        title = str(arguments.get("title") or "").strip()
        content = str(arguments.get("content") or "")
        if not title or not content.strip():
            raise ValidationException("文档标题和内容不能为空")
        document = self.repo.add_document(project, title[:200], content[:200000])
        return {"id": document.id, "title": document.title}

    def apply_write(self, project: HarnessProjectModel, call: ToolCallModel) -> dict:
        if call.name != "write_file":
            raise ValidationException("该工具调用不是文件写入")
        try:
            arguments = json.loads(call.arguments_json)
        except ValueError as exc:
            raise ValidationException("写入参数解析失败") from exc
        target, relative = self.safe_file_target(project, str(arguments.get("path") or ""))
        pending = self._pending_path(project, call.id)
        if not pending.is_file():
            raise ValidationException("待审批写入内容已失效，请重新生成")
        content = pending.read_text(encoding="utf-8")
        if len(content.encode("utf-8")) > 10 * 1024 * 1024:
            raise ValidationException("写入内容超过 10MB 限制")

        backup_path = ""
        if target.exists():
            backup_root = self.workspace_root / "_backups" / project.id
            backup_root.mkdir(parents=True, exist_ok=True)
            backup = backup_root / f"{time.strftime('%Y%m%d-%H%M%S')}-{target.name}"
            shutil.copy2(target, backup)
            backup_path = str(backup.relative_to(self.workspace_root))

        temporary = target.with_name(f".{target.name}.{os.urandom(6).hex()}.tmp")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with temporary.open("w", encoding="utf-8", newline="") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if temporary.exists():
                temporary.unlink()

        self.repo.upsert_file(project, relative, target.name, "text/plain", content)
        pending.unlink(missing_ok=True)
        return {
            "path": relative,
            "bytes": len(content.encode("utf-8")),
            "backupPath": backup_path,
            "atomic": True,
        }

    def cleanup_pending(self, project: HarnessProjectModel, tool_call_id: str) -> None:
        self._pending_path(project, tool_call_id).unlink(missing_ok=True)

    def remove_project_files(self, project: HarnessProjectModel) -> None:
        """Remove only this project's sandbox, pending writes, and backups."""
        for relative_root in (Path(project.id), Path("_pending") / project.id, Path("_backups") / project.id):
            target = (self.workspace_root / relative_root).resolve()
            target.relative_to(self.workspace_root)
            if target.exists():
                shutil.rmtree(target)
