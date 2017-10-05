/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import exec, {ExecResult} from './util/exec';
import {existsSync} from './util/fs';
import path = require('path');

export class GitRepo {
  dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /**
   * Returns true if directory exists and its own git repo.
   */
  isGit(): boolean {
    return existsSync(path.join(this.dir, '.git'));
  }

  /**
   * Returns the git commit hash at HEAD.
   */
  async getHeadSha(): Promise<ExecResult> {
    return await exec(this.dir, 'git', ['rev-parse', 'HEAD']);
  }

  /**
   * Run `git clone [url] [this.dir]`.
   */
  async clone(url: string): Promise<ExecResult> {
    return await exec(
        process.cwd(),
        'git',
        ['clone', url, this.dir, '--depth', '1', '--no-single-branch']);
  }

  /**
   * Run `git fetch [remoteName]`. If remoteName is not given, git will fetch
   * from default.
   */
  async fetch(remoteName: string = ''): Promise<ExecResult> {
    return await exec(this.dir, 'git', ['fetch', remoteName, '--depth', '1']);
  }

  /**
   * Run `git checkout [branch]`.
   */
  async checkout(branch: string): Promise<ExecResult> {
    return await exec(this.dir, 'git', ['checkout', branch, '--']);
  }

  /**
   * Resets the repo back to a clean state. Note that this deletes any
   * uncommitted changes and untracked files in the repo directory, created
   * through tooling or otherwise.
   */
  async destroyAllUncommittedChangesAndFiles():
      Promise<{reset: ExecResult, clean: ExecResult}> {
    const resetResult = await exec(this.dir, 'git', ['reset', '--hard']);
    const cleanResult = await exec(this.dir, 'git', ['clean', '-fd']);
    return {
      reset: resetResult,
      clean: cleanResult,
    };
  }
}
