#!/usr/bin/env node

const fs = require('fs-extra')
const path = require('path')

/**
 * Installation script for core-media-modules
 * Syncs folders to the parent package and creates .gitignore files
 */

// Folders to sync to parent package.
const FOLDERS_TO_SYNC = ['_tools']

// Files to copy to the root of the parent package.
const FILES_TO_COPY = ['run-linux.sh', 'run-mac.command', 'run-windows.bat']

let moduleRoot
let parentRoot

async function install () {
  const logMessages = []

  function log (message, level) {
    // Only collect error messages for log file
    if (level === 'error') {
      const timestamp = new Date().toISOString()
      const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}`
      logMessages.push(logEntry)
      console.error(message)
    }
  }

  try {
    // Get the path to the parent package (where this package is installed)
    moduleRoot = __dirname
    parentRoot = path.resolve(moduleRoot, '../../..')

    // Skip syncing when this package is not installed as a dependency
    // (e.g. developing the repo itself). Dependency installs live under
    // node_modules (npm/pnpm) or .yalc (yalc); without either ancestor the
    // parent-root fallback resolves to the drive root, which is not writable.
    if (!moduleRoot.includes('node_modules') && !moduleRoot.includes('.yalc')) {
      console.log('core-media-modules: not installed as a dependency; skipping module sync.')
      return
    }

    // Standard npm install: node_modules/@electricbookworks/core-media-modules
    if (moduleRoot.includes('node_modules')) {
      // Find the node_modules directory and get the project root
      const nodeModulesIndex = moduleRoot.lastIndexOf('node_modules')
      if (nodeModulesIndex !== -1) {
        parentRoot = moduleRoot.substring(0, nodeModulesIndex - 1) // Remove trailing slash before node_modules
      }
    }

    // Validate parent root exists and is writable
    if (!await fs.pathExists(parentRoot)) {
      const errorMsg = `Parent directory does not exist: ${parentRoot}`
      log(errorMsg, 'error')
      process.exit(1)
    }

    try {
      await fs.access(parentRoot, fs.constants.W_OK)
    } catch (accessError) {
      const errorMsg = `No write permission to parent directory: ${parentRoot}`
      log(errorMsg, 'error')
      process.exit(1)
    }

    for (const folder of FOLDERS_TO_SYNC) {
      try {
        // Source and destination paths
        const sourcePath = path.join(moduleRoot, folder)
        const destPath = path.join(parentRoot, folder)
        const gitignorePath = path.join(destPath, '.gitignore')

        // Check if source folder exists
        if (!await fs.pathExists(sourcePath)) {
          continue // Skip this folder but continue with others
        }

        // Empty the destination folder before copying
        if (await fs.pathExists(destPath)) {
          await fs.emptyDir(destPath)
        }

        // Copy the folder
        await fs.copy(sourcePath, destPath, {
          overwrite: true,
          preserveTimestamps: true,
          errorOnExist: false
        })

        // Create .gitignore file in the copied folder
        const gitignoreContent = `# Electric Book ${folder}
# This folder is managed by @electricbookworks/core-media-modules
# Do not track any files in this folder
*
!.gitignore
`
        await fs.writeFile(gitignorePath, gitignoreContent, 'utf8')
      } catch (folderError) {
        log(`Error processing ${folder}: ${folderError.message}`, 'error')
        // Continue with other folders instead of exiting
      }
    }

    // Sync custom folders from parent (e.g. _tools-custom -> _tools)
    for (const folder of FOLDERS_TO_SYNC) {
      try {
        const customFolderPath = path.join(parentRoot, `${folder}-custom`)
        const folderDestPath = path.join(parentRoot, folder)
        if (await fs.pathExists(customFolderPath)) {
          await fs.copy(customFolderPath, folderDestPath, {
            overwrite: true,
            preserveTimestamps: true,
            errorOnExist: false
          })
        }
      } catch (customError) {
        log(`Error syncing ${folder}-custom: ${customError.message}`, 'error')
      }
    }

    // Create gulpfile.js in parent root
    try {
      const gulpfilePath = path.join(parentRoot, 'gulpfile.js')
      const gulpfileContent = 'module.exports = require(\'./_tools/gulpfile\')\n'
      await fs.writeFile(gulpfilePath, gulpfileContent, 'utf8')
    } catch (gulpfileError) {
      log(`Error creating gulpfile.js: ${gulpfileError.message}`, 'error')
    }

    // Copy run scripts to parent root
    for (const file of FILES_TO_COPY) {
      try {
        const sourcePath = path.join(moduleRoot, file)
        const destPath = path.join(parentRoot, file)
        if (!await fs.pathExists(sourcePath)) {
          continue
        }
        await fs.copy(sourcePath, destPath, {
          overwrite: true,
          preserveTimestamps: true,
          errorOnExist: false
        })
        // Ensure unix scripts stay executable (npm may strip permissions)
        if (path.extname(file) !== '.bat') {
          await fs.chmod(destPath, 0o755)
        }
      } catch (fileError) {
        log(`Error copying ${file}: ${fileError.message}`, 'error')
      }
    }

    if (logMessages.length > 0) {
      const logPath = path.join(parentRoot, 'core-media-modules-install.log')
      await fs.writeFile(logPath, logMessages.join('\n'), 'utf8')
    }
  } catch (error) {
    const errorMsg = `Error during installation: ${error.message}`
    try {
      const logPath = path.join(parentRoot, 'core-media-modules-install.log')
      logMessages.push(`[${new Date().toISOString()}] ERROR: ${errorMsg}`)
      await fs.writeFile(logPath, logMessages.join('\n'), 'utf8')
    } catch (logError) {
      // If we can't write the log, at least show the original error
      console.error('Failed to write log file:', logError.message)
    }
    process.exit(1)
  }
}

// Run the installation if this script is executed directly
if (require.main === module) {
  install()
}

module.exports = install
