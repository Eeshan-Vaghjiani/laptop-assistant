import path from 'node:path';

const destructive = /\b(remove-item|clear-content|clear-recyclebin|del|erase|rmdir|rd|rm|unlink|shred|truncate|format-volume|format|diskpart|remove-partition|clear-disk|mkfs|wipefs)\b|\.(unlink|rmdir|rmtree|remove|truncate)\s*\(|\b(git\s+clean|git\s+reset\s+--hard)\b|\brobocopy\b[^\n]*(\/mir|\/purge)/i;
const systemCommand = /\b(bcdedit|bootrec|reg(?:\.exe)?\s+(?:add|delete|import)|set-acl|takeown|icacls|chmod|chown|sudo|runas|disable-windowsoptionalfeature|stop-service|set-service)\b/i;
const opaque = /(?:-enc(?:odedcommand)?\s|frombase64string|invoke-expression|\biex\b|\beval\s*\(|\bexec\s*\(|\b(?:cmd|powershell|pwsh|bash|sh)\b[^\n]*\s-f(?:ile)?\s)/i;

export function sensitivePath(value, cwd = process.cwd()) {
  if (typeof value !== 'string') return false;
  const windows = /^[a-z]:[\\/]/i.test(value) || /^[a-z]:[\\/]/i.test(cwd);
  const api = windows ? path.win32 : path.posix;
  const p = api.resolve(cwd, value).replaceAll('\\', '/').toLowerCase();
  return /^[a-z]:\/$/.test(p) || /^[a-z]:\/(windows|program files(?: \(x86\))?|programdata|boot|efi)(\/|$)/.test(p)
    || /^\/(?:etc|boot|usr|bin|sbin|lib|lib64|sys|proc)(\/|$)/.test(p) || p === '/'
    || /\/(?:\.ssh|\.gnupg|\.aws|\.azure|\.copilot)(\/|$)/.test(p);
}

// A confirmation policy, not an OS sandbox. Native tool path metadata is checked
// alongside the command; opaque executable scripts are not classified as safe.
export function confirmationReason(request, cwd) {
  if (request.managedApprovalRequired) return 'Your organisation requires approval for this action.';
  if (request.requestSandboxBypass) return 'This action requests expanded execution permissions.';
  if (request.kind === 'read' || request.kind === 'url') return null;
  const text = String(request.fullCommandText || request.command || '');
  const deletionDiff = /\+\+\+\s+\/dev\/null|\*\*\* Delete File:/.test(request.diff || '');
  if (destructive.test(text) || deletionDiff) return 'This action may delete or overwrite files. Please confirm the exact targets.';
  if (systemCommand.test(text)) return 'This action changes system configuration or file permissions.';
  const paths = [request.resolvedPath, request.fileName, request.path, request.resolvedWorkingDirectory,
    ...(request.possiblePaths || []), ...Object.values(request.resolvedPaths || {})].filter(v => typeof v === 'string');
  const readOnly = request.kind === 'shell' && request.commands?.length && request.commands.every(c => c.readOnly === true) && !request.hasWriteFileRedirection;
  if (!readOnly && (paths.some(p => sensitivePath(p, cwd)) || /[a-z]:[\\/](windows|program files|programdata|boot|efi)\b/i.test(text))) {
    return 'This action may alter a protected system or credential folder.';
  }
  if (request.kind === 'write') return paths.length ? null : 'The destination of this write could not be verified.';
  if (request.kind === 'shell') {
    if (opaque.test(text)) return 'This command executes encoded or dynamically generated code.';
    if (!text.trim()) return 'The command could not be inspected.';
    if (/\b(?:python[\d.]*|node|ruby|perl|powershell|pwsh|bash|sh|cmd)(?:\.exe)?\s+(?!-[cCeE]\b)(?:["']?[^\s]+\.(?:py|js|mjs|cjs|ps1|sh|bat|cmd))\b/i.test(text)) return 'This action runs a script whose effects need review.';
    return null;
  }
  if (request.kind === 'custom-tool' && /^assistant_(find_files|inspect_images|read_document|show_files)$/.test(request.toolName || '')) return null;
  return 'This external action needs your confirmation.';
}
