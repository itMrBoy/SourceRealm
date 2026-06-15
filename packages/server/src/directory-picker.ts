import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type DirectoryPicker = () => Promise<string | null>

export async function pickDirectory(): Promise<string | null> {
  const platform = os.platform()
  if (platform === 'win32') return pickWindowsDirectory()
  if (platform === 'darwin') return pickMacDirectory()
  return pickLinuxDirectory()
}

async function pickWindowsDirectory(): Promise<string | null> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = '选择要导入 SourceRealm 的代码目录'",
    '$dialog.ShowNewFolderButton = $false',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::Out.Write($dialog.SelectedPath)',
    '}',
  ].join('; ')
  return runPicker('powershell.exe', ['-NoProfile', '-STA', '-Command', script])
}

async function pickMacDirectory(): Promise<string | null> {
  return runPicker('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择要导入 SourceRealm 的代码目录")'])
}

async function pickLinuxDirectory(): Promise<string | null> {
  try {
    return await runPicker('zenity', ['--file-selection', '--directory', '--title=选择要导入 SourceRealm 的代码目录'])
  } catch {
    return runPicker('kdialog', ['--getexistingdirectory', '.', '选择要导入 SourceRealm 的代码目录'])
  }
}

async function runPicker(file: string, args: string[]): Promise<string | null> {
  const { stdout } = await execFileAsync(file, args, { windowsHide: false })
  const selected = stdout.trim()
  return selected ? selected : null
}
