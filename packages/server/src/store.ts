import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { z } from 'zod'
import {
  CourseSchema,
  LevelSchema,
  ProgressSchema,
  ProjectMetaSchema,
  type Course,
  type Level,
  type Progress,
  type ProjectMeta,
} from '@code-quest/shared'

export function dataRoot(): string {
  return process.env.CODE_QUEST_HOME ?? path.join(os.homedir(), '.code-quest')
}

export function projectIdFor(repoPath: string): string {
  return createHash('sha256').update(path.resolve(repoPath)).digest('hex').slice(0, 12)
}

export class ProjectStore {
  constructor(readonly id: string) {}

  get dir(): string {
    return path.join(dataRoot(), this.id)
  }

  private async readJson<T>(file: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const raw = await fs.readFile(path.join(this.dir, file), 'utf8')
      return schema.parse(JSON.parse(raw))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  /** 原子写:先写临时文件再 rename */
  private async writeJson<T>(file: string, schema: z.ZodType<T>, value: T): Promise<void> {
    const parsed = schema.parse(value)
    const target = path.join(this.dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${randomUUID()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(parsed, null, 2))
    await fs.rename(tmp, target)
  }

  readMeta() { return this.readJson('project.json', ProjectMetaSchema) }
  writeMeta(v: ProjectMeta) { return this.writeJson('project.json', ProjectMetaSchema, v) }
  readCourse() { return this.readJson('course.json', CourseSchema) }
  writeCourse(v: Course) { return this.writeJson('course.json', CourseSchema, v) }
  readProgress() { return this.readJson('progress.json', ProgressSchema) }
  writeProgress(v: Progress) { return this.writeJson('progress.json', ProgressSchema, v) }
  readLevel(id: string) { return this.readJson(path.join('levels', `${id}.json`), LevelSchema) }
  writeLevel(v: Level) { return this.writeJson(path.join('levels', `${v.id}.json`), LevelSchema, v) }

  static async list(): Promise<ProjectMeta[]> {
    let ids: string[]
    try {
      ids = await fs.readdir(dataRoot())
    } catch {
      return []
    }
    const metas = await Promise.all(ids.map((id) => new ProjectStore(id).readMeta().catch(() => null)))
    return metas.filter((m): m is ProjectMeta => m !== null)
  }
}
