// This gulpfile processes:
// - images, optimising them for output formats
// - Javascript, optionally, minifying scripts for performance
// - HTML, rendering MathJax as MathML.
// It takes two arguments: --book and --language, e.g.:
// gulp --book samples --language fr

// Get Node modules
const gulp = require('gulp')
const uglify = require('gulp-uglify')
const rename = require('gulp-rename')
const newer = require('gulp-newer')
const gm = require('gulp-gm')
const svgmin = require('gulp-svgmin')
const args = require('yargs').argv
const fileExists = require('file-exists')
const fs = require('fs')
const yaml = require('js-yaml')
const debug = require('gulp-debug')
const tap = require('gulp-tap')
const gulpif = require('gulp-if')
const xmlEdit = require('gulp-edit-xml')
const path = require('path')
const imageFunctions = require('require-all')(path.join(__dirname, 'gulp/images'))

// Load image settings if they exist
let imageSettings = []
if (fs.existsSync('_data/images.yml')) {
  imageSettings = yaml.load(fs.readFileSync('_data/images.yml', 'utf8'))

  // If the file is empty, imageSettings will be null.
  // So we check for that and, if null, we create an array.
  if (!imageSettings) {
    imageSettings = []
  }
}

// Get the image functions to apply for a book, as defined in images.yml.
// Each image can list functions by name. Each name must match a function
// exported by a script in _tools/gulp/images/functions:
//
// microeconomics:
//   - file: "figure-01-05.svg"
//     functions:
//       - svgFonts:
function getImageFunctions (bookName) {
  // Map exported function names to functions, from the scripts
  // at the top level of _tools/gulp/images/functions.
  const availableFunctions = {}
  const functionModules = (imageFunctions && imageFunctions.functions) || {}
  Object.keys(functionModules).forEach(function (moduleName) {
    const moduleExports = functionModules[moduleName]
    Object.keys(moduleExports).forEach(function (exportName) {
      if (typeof moduleExports[exportName] === 'function') {
        availableFunctions[exportName] = moduleExports[exportName]
      }
    })
  })

  // Group the book's images by the functions listed for them.
  const filesByFunction = {}
  const images = Array.isArray(imageSettings[bookName]) ? imageSettings[bookName] : []
  images.forEach(function (image) {
    if (!image || !image.file || !Array.isArray(image.functions)) {
      return
    }
    image.functions.forEach(function (entry) {
      const functionNames = typeof entry === 'string' ? [entry] : Object.keys(entry || {})
      functionNames.forEach(function (functionName) {
        filesByFunction[functionName] = filesByFunction[functionName] || []
        filesByFunction[functionName].push(image.file)
      })
    })
  })

  const functionsToApply = []
  Object.keys(filesByFunction).forEach(function (functionName) {
    if (!availableFunctions[functionName]) {
      console.log('No function named ' + functionName + ' found in _tools/gulp/images/functions, as listed in images.yml')
      return
    }
    functionsToApply.push({
      name: functionName,
      files: filesByFunction[functionName],
      run: availableFunctions[functionName]
    })
  })

  return functionsToApply
}

// Get the book we're processing
let book = 'book'
if (args.book && args.book.trim() !== '') {
  book = args.book
}

// let '--folder' be an alias for '--book',
// to make sense for gulping 'assets'
if (args.folder && args.folder.trim() !== '') {
  book = args.folder
}

// Reminder on usage
if (book === 'book') {
  console.log('If processing images for a book that\'s not in the /book directory, use the --book argument, e.g. gulp --book potatoes')
  console.log('To process images in assets, use gulp --folder assets')
}

// Get the language we're processing. English is the default
// language, whose files are not in a language subfolder,
// so we ignore 'en' if it's specified.
let language = ''
const languageArg = typeof args.language === 'string' ? args.language.trim() : ''
if (languageArg !== '' && languageArg.toLowerCase() !== 'en') {
  language = '/' + languageArg
}

// Reminder on usage
if (languageArg === '') {
  console.log('If processing a translation\'s images, use the --language argument, e.g. gulp --language fr')
}

// Get the output format we're working with
let output = ''
if (args.output && args.output.trim() !== '') {
  output = args.output
}

// Reminder on usage
if (output === '') {
  console.log('If processing for a specific output, use the --output argument, e.g. gulp --output printpdf. No hyphens.')
}

// Set up paths.
// Paths to text src must include the *.html extension.
// Add paths to any JS files to minify to the src array, e.g.
// src: ['assets/js/foo.js,assets/js/bar.js'],
const paths = {
  img: {
    source: book + language + '/images/_source/',
    printpdf: book + language + '/images/print-pdf/',
    web: book + language + '/images/web/',
    screenpdf: book + language + '/images/screen-pdf/',
    epub: book + language + '/images/epub/',
    app: book + language + '/images/app/'
  },
  text: {
    src: '_site/' + book + language + '/text/*.html',
    dest: '_site/' + book + language + '/text/'
  },
  epub: {
    src: '_site/epub/' + book + language + '/text/*.html',
    dest: '_site/epub/' + book + language + '/text/'
  },
  js: {
    src: [],
    dest: 'assets/js/'
  },
  yaml: {
    src: ['*.yml', '_configs/*.yml', '_data/*.yml']
  },
  // Arrays of globs to ignore from tasks
  ignore: {
    printpdf: ['**/favicon.*'],
    web: [],
    screenpdf: ['**/favicon.*'],
    epub: ['**/favicon.*'],
    app: ['**/favicon.*']
  }
}

// Set filetypes to convert, comma separated, no spaces
const filetypes = 'jpg,jpeg,gif,png'

// Default color settings
const defaultColorProfile = 'sRGB_v4_ICC_preference_displayclass.icc'
const defaultColorSpace = 'rgb'
const defaultColorProfileGrayscale = 'Grey_Fogra39L.icc'
const defaultColorSpaceGrayscale = 'gray'
const defaultOutputFormat = 'web'

// Function for checking if an image should be processed
function modifyImageCheck (filename, format) {
  // Assume true
  let modifyImage = true

  if (!format) {
    format = 'all'
  }

  if (imageSettings[book]) {
    imageSettings[book].forEach(function (image) {
      if (image.file === filename) {
        // User feedback for images not being modified
        const noModifyFeedback = filename + ' not modified for ' + format + ' format(s), as specified in images.yml'

        // We use the same SVG for all output formats. So:
        // if this is an SVG, do *any* of the output formats
        // have 'modify' set to no? If so, do not modify it.
        if (filename.match(/[^\s]+\.svg$/gi)) {
          const outputFormats = ['print-pdf', 'screen-pdf', 'web', 'epub', 'app', 'all']
          outputFormats.forEach(function (format) {
            if (image[format] && image[format].modify && image[format].modify === 'no') {
              console.log(noModifyFeedback)
              modifyImage = false
            }
          })
        }

        // If an image has a 'modify' setting for this or all formats...
        if (image.modify || (image[format] && image[format].modify) ||
                        (image.all && image.all.modify)) {
          // ... and it's set to no, do not modify.
          if (image.modify === 'no' || (image[format] && image[format].modify === 'no') ||
                            (image.all && image.all.modify === 'no')) {
            console.log(noModifyFeedback)
            modifyImage = false
          }
        }
      }
    })
  }

  return modifyImage
}

// Function for getting a filename in gulp tap
function getFilenameFromPath (path) {
  let filename = path.split('/').pop() // for unix slashes
  filename = filename.split('\\').pop() // for windows backslashes
  return filename
}

function lookupColorSettings (gmfile,
  colorProfile, colorSpace,
  colorProfileGrayscale, colorSpaceGrayscale,
  outputFormat) {
  const filename = getFilenameFromPath(gmfile.source)

  // Look up image settings
  if (imageSettings[book]) {
    imageSettings[book].forEach(function (image) {
      if (image.file === filename || image.file === 'all') {
        if (image[outputFormat] && image[outputFormat].colorspace === 'gray') {
          colorProfile = colorProfileGrayscale
          colorSpace = colorSpaceGrayscale
        }
      }
    })
  }

  return {
    colorSpace,
    colorProfile
  }
}

// Minify and clean SVGs and copy to destinations.
// For EpubCheck-safe SVGs, we remove data- attributes
// and don't strip defaults like <style "type=text/css">
// Build the SVG-processing stream for one output format. The format is
// passed to the image functions so they can vary behaviour per format,
// e.g. skip the remote Google Fonts @import for epub, where remote
// resources are not allowed by EPUBCheck.
function processSVGs (outputFormat) {
  // Since SVGs are used as-as for all output formats,
  // we can perform this check with gulpif based only
  // on the file path, which is accessible with gulpif.
  const modifyImage = function (file) {
    const filename = getFilenameFromPath(file.path)
    const modificationStatus = modifyImageCheck(filename)
    return modificationStatus
  }

  let stream = gulp.src(paths.img.source + '*.svg')
    .pipe(debug({ title: 'Processing SVG (' + outputFormat + ') ' }))
    .pipe(gulpif(modifyImage, svgmin({
      plugins: [
        // This first pass only runs minifyStyles, to remove CDATA from
        // <style> elements and give later access to inlineStyles.
        { minifyStyles: true },
        { removeDoctype: false },
        { removeXMLProcInst: false },
        { removeComments: false },
        { removeMetadata: false },
        { removeXMLNS: false },
        { removeEditorsNSData: false },
        { cleanupAttrs: false },
        { mergeStyles: false },
        { inlineStyles: false },
        { convertStyleToAttrs: false },
        { cleanupIDs: false },
        { prefixIds: false },
        { removeRasterImages: false },
        { removeUselessDefs: false },
        { cleanupNumericValues: false },
        { cleanupListOfValues: false },
        { convertColors: false },
        { removeUnknownsAndDefaults: false },
        { removeNonInheritableGroupAttrs: false },
        { removeUselessStrokeAndFill: false },
        { removeViewBox: false },
        { cleanupEnableBackground: false },
        { removeHiddenElems: false },
        { removeEmptyText: false },
        { convertShapeToPath: false },
        { convertEllipseToCircle: false },
        { moveElemsAttrsToGroup: false },
        { moveGroupAttrsToElems: false },
        { collapseGroups: false },
        { convertPathData: false },
        { convertTransform: false },
        { removeEmptyAttrs: false },
        { removeEmptyContainers: false },
        { mergePaths: false },
        { removeUnusedNS: false },
        { sortAttrs: false },
        { sortDefsChildren: false },
        { removeTitle: false },
        { removeDesc: false },
        { removeDimensions: false },
        { removeAttrs: false },
        { removeAttributesBySelector: false },
        { removeElementsByAttr: false },
        { addClassesToSVGElement: false },
        { removeStyleElement: false },
        { removeScriptElement: false },
        { addAttributesToSVGElement: false },
        { removeOffCanvasPaths: false },
        { reusePaths: false }
      ]
    })))
    .pipe(gulpif(modifyImage, svgmin(function getOptions () {
      return {
        plugins: [
          {
            // We definitely want a viewBox
            removeViewBox: false
          },
          {
            // With a viewBox, we can remove these
            removeDimensions: true
          },
          {
            // We can remove data- attributes
            removeAttrs: {
              attrs: 'data.*'
            }
          },
          {
            // Remove unknown elements, but not default values
            removeUnknownsAndDefaults: {
              defaultAttrs: false
            }
          },
          {
            // We want titles for accessibility
            removeTitle: false
          },
          {
            // We want descriptions for accessibility
            removeDesc: false
          },
          {
            // No, this is too destructive
            convertStyleToAttrs: false
          },
          {
            // Default
            removeUselessStrokeAndFill: true
          },
          {
            // Default
            inlineStyles: {
              onlyMatchedOnce: false
            }
          },
          {
            // Default
            cleanupAttrs: true
          },
          {
            // Default
            removeDoctype: true
          },
          {
            // Default
            removeXMLProcInst: true
          },
          {
            // Default
            removeComments: true
          },
          {
            // Default
            removeMetadata: true
          },
          {
            // Default
            removeUselessDefs: true
          },
          {
            // Default
            removeXMLNS: false
          },
          {
            // Default
            removeEditorsNSData: true
          },
          {
            // Default
            removeEmptyAttrs: true
          },
          {
            // Default
            removeHiddenElems: true
          },
          {
            // Default
            removeEmptyText: true
          },
          {
            // Default
            removeEmptyContainers: true
          },
          {
            // Default
            cleanupEnableBackground: true
          },
          {
            // Default
            minifyStyles: true
          },
          {
            // Default
            convertColors: true
          },
          {
            // Default
            convertPathData: true
          },
          {
            // Default
            convertTransform: true
          },
          {
            // Default
            removeNonInheritableGroupAttrs: true
          },
          {
            // Default
            removeUselessStrokeAndFill: true
          },
          {
            // Default
            removeUnusedNS: true
          },
          {
            // Default
            prefixIds: true
          },
          {
            // Default
            cleanupIDs: true
          },
          {
            // Default
            cleanupNumericValues: true
          },
          {
            // Default
            cleanupListOfValues: true
          },
          {
            // Default
            moveElemsAttrsToGroup: true
          },
          {
            // Default
            collapseGroups: true
          },
          {
            // Default
            removeRasterImages: false
          },
          {
            // Default
            mergePaths: true
          },
          {
            // Default
            convertShapeToPath: false
          },
          {
            // Default
            convertEllipseToCircle: true
          },
          {
            // Default
            sortAttrs: false
          },
          {
            // Default
            sortDefsChildren: true
          },
          {
            // Default
            removeAttributesBySelector: false
          },
          {
            // Default
            removeElementsByAttr: false
          },
          {
            // Default
            addClassesToSVGElement: false
          },
          {
            // Default
            addAttributesToSVGElement: false
          },
          {
            // Default
            removeOffCanvasPaths: false
          },
          {
            // Default
            removeStyleElement: false
          },
          {
            // Default
            removeScriptElement: false
          },
          {
            // Default
            reusePaths: false
          }
        ]
      }
    }).on('error', function (e) {
      console.log(e)
    })))
    // Apply SVG manipulation functions stored in _tools/gulp/images/functions.
    .pipe(gulpif(() => {
      // If there is a [book]AllSvg.js function, run it
      return imageFunctions.functions &&
                imageFunctions.functions[book] &&
                imageFunctions.functions[book].all_svg &&
                imageFunctions.functions[book].all_svg.all_svg
    },
    xmlEdit(function (xml) {
      console.log('Running the ' + 'all_svg function on ' + book)
      imageFunctions.functions[book].all_svg.all_svg(xml, outputFormat)
      return xml
    })
    ))

  // Apply each function defined in images.yml to the SVGs listed for this book.
  getImageFunctions(book).forEach(function (imageFunction) {
    stream = stream.pipe(gulpif(function (file) {
      const imageFilename = getFilenameFromPath(file.path)
      if (imageFunction.files.includes(imageFilename)) {
        console.log('Running the ' + imageFunction.name + ' function on ' + imageFilename + ' (' + outputFormat + ')')
        return true
      }
      return false
    }, xmlEdit(function (xml) {
      imageFunction.run(xml, outputFormat)
      return xml
    })))
  })

  return stream
}

// Process SVGs for all output formats. The non-epub formats share a
// single pass (with the Google Fonts @import injected); epub gets its
// own pass that skips the import, so its SVGs stay valid for EPUBCheck.
// 'web' here stands in for all non-epub formats, which are treated alike.
gulp.task('images:svg', function (done) {
  console.log('Processing SVG images from ' + paths.img.source)

  processSVGs('web')
    .pipe(gulp.dest(paths.img.printpdf))
    .pipe(gulp.dest(paths.img.screenpdf))
    .pipe(gulp.dest(paths.img.web))
    .pipe(gulp.dest(paths.img.app))

  processSVGs('epub')
    .pipe(gulp.dest(paths.img.epub))

  done()
})

// Convert source images for print-pdf
gulp.task('images:printpdf', function (done) {
  // Options
  const outputFormat = 'print-pdf'
  const colorProfile = 'PSOcoated_v3.icc'
  const colorSpace = 'cmyk'
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Processing ' + outputFormat + ' images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.printpdf })
      .pipe(newer(paths.img.printpdf))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(gulp.dest(paths.img.printpdf))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Convert and optimise source images
// for screen-pdf, web, epub, and app
gulp.task('images:screenpdf', function (done) {
  // Options
  const outputFormat = 'screen-pdf'
  const colorProfile = defaultColorProfile
  const colorSpace = defaultColorSpace
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Processing ' + outputFormat + ' images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.screenpdf })
      .pipe(newer(paths.img.screenpdf))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(gulp.dest(paths.img.screenpdf))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Convert and optimise source images
// for screen-pdf, web, epub, and app
gulp.task('images:epub', function (done) {
  // Options
  const outputFormat = 'epub'
  const colorProfile = defaultColorProfile
  const colorSpace = defaultColorSpace
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Processing epub images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.epub })
      .pipe(newer(paths.img.epub))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks except `return gmfile` settings
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .resize(810, null, '>') // *
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)
            .quality(90)

          // * The '>' option specifies that the image should not be made larger
          //   if the original's width is less than the target width.
          //   See http://www.graphicsmagick.org/GraphicsMagick.html#details-geometry
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(gulp.dest(paths.img.epub))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Convert and optimise source images
// for screen-pdf, web, epub, and app
gulp.task('images:app', function (done) {
  // Options
  const outputFormat = 'app'
  const colorProfile = defaultColorProfile
  const colorSpace = defaultColorSpace
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Processing app images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.app })
      .pipe(newer(paths.img.app))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks except `return gmfile` settings
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .resize(810, null, '>') // *
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)
            .quality(90)

          // * The '>' option specifies that the image should not be made larger
          //   if the original's width is less than the target width.
          //   See http://www.graphicsmagick.org/GraphicsMagick.html#details-geometry
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(gulp.dest(paths.img.app))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Convert and optimise source images
// for screen-pdf, web, epub, and app
gulp.task('images:web', function (done) {
  // Options
  const outputFormat = defaultOutputFormat
  const colorProfile = defaultColorProfile
  const colorSpace = defaultColorSpace
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Processing web images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.web })
      .pipe(newer(paths.img.web))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks except `return gmfile` settings
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .resize(810, null, '>') // *
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)
            .quality(90)

          // * The '>' option specifies that the image should not be made larger
          //   if the original's width is less than the target width.
          //   See http://www.graphicsmagick.org/GraphicsMagick.html#details-geometry
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(gulp.dest(paths.img.web))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Make small images for web use in srcset
gulp.task('images:small', function (done) {
  // Options
  const outputFormat = defaultOutputFormat
  const colorProfile = defaultColorProfile
  const colorSpace = defaultColorSpace
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Creating small web images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.web })
      .pipe(newer(paths.img.web))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks except `return gmfile` settings
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .resize(320, null, '>') // *
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)
            .quality(90)

          // * The '>' option specifies that the image should not be made larger
          //   if the original's width is less than the target width.
          //   See http://www.graphicsmagick.org/GraphicsMagick.html#details-geometry
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(rename({ suffix: '-320' }))
      .pipe(gulp.dest(paths.img.web))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Make medium images for web use in srcset
gulp.task('images:medium', function (done) {
  // Options
  const outputFormat = defaultOutputFormat
  const colorProfile = defaultColorProfile
  const colorSpace = defaultColorSpace
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Creating medium web images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.web })
      .pipe(newer(paths.img.web))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks except `return gmfile` settings
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .resize(640, null, '>') // *
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)
            .quality(90)

          // * The '>' option specifies that the image should not be made larger
          //   if the original's width is less than the target width.
          //   See http://www.graphicsmagick.org/GraphicsMagick.html#details-geometry
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(rename({ suffix: '-640' }))
      .pipe(gulp.dest(paths.img.web))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Make large images for web use in srcset
gulp.task('images:large', function (done) {
  // Options
  const outputFormat = defaultOutputFormat
  const colorProfile = defaultColorProfile
  const colorSpace = defaultColorSpace
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Creating large web images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.web })
      .pipe(newer(paths.img.web))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks except `return gmfile` settings
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .resize(1024, null, '>') // *
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)
            .quality(90)

          // * The '>' option specifies that the image should not be made larger
          //   if the original's width is less than the target width.
          //   See http://www.graphicsmagick.org/GraphicsMagick.html#details-geometry
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(rename({ suffix: '-1024' }))
      .pipe(gulp.dest(paths.img.web))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Make extra-large images for web use in srcset
gulp.task('images:xlarge', function (done) {
  // Options
  const outputFormat = defaultOutputFormat
  const colorProfile = defaultColorProfile
  const colorSpace = defaultColorSpace
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Creating extra-large web images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.web })
      .pipe(newer(paths.img.web))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks except `return gmfile` settings
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .resize(2048, null, '>') // *
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)
            .quality(90)

          // * The '>' option specifies that the image should not be made larger
          //   if the original's width is less than the target width.
          //   See http://www.graphicsmagick.org/GraphicsMagick.html#details-geometry
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(rename({ suffix: '-2048' }))
      .pipe(gulp.dest(paths.img.web))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Make full-quality images in RGB
gulp.task('images:max', function (done) {
  // Options
  const outputFormat = defaultOutputFormat
  const colorProfile = defaultColorProfile
  const colorSpace = defaultColorSpace
  const colorProfileGrayscale = defaultColorProfileGrayscale
  const colorSpaceGrayscale = defaultColorSpaceGrayscale

  console.log('Creating max-quality web images from ' + paths.img.source)
  if (fileExists.sync('_tools/profiles/' + colorProfile)) {
    gulp.src(paths.img.source + '*.{' + filetypes + '}',
      { ignore: paths.ignore.web })
      .pipe(newer(paths.img.web))

    // --------------------------------------------------------------
    // Same for all bitmap image tasks except `return gmfile` settings
      .pipe(debug({ title: 'Creating ' + outputFormat + ' version of ' }))
      .pipe(gm(function (gmfile) {
        // Get file details
        const filename = getFilenameFromPath(gmfile.source)

        // Check if we should modify this image
        const modifyImage = modifyImageCheck(filename, outputFormat)

        // Reset defaults (in case previous image in stream
        // set these values to something else)
        let thisColorSpace = colorSpace
        let thisColorProfile = colorProfile

        // Override
        const colorSettings = lookupColorSettings(gmfile, colorProfile, colorSpace,
          colorProfileGrayscale, colorSpaceGrayscale, outputFormat)
        thisColorSpace = colorSettings.colorSpace
        thisColorProfile = colorSettings.colorProfile

        if (modifyImage) {
          return gmfile
            .profile('_tools/profiles/' + thisColorProfile)
            .colorspace(thisColorSpace)

          // * The '>' option specifies that the image should not be made larger
          //   if the original's width is less than the target width.
          //   See http://www.graphicsmagick.org/GraphicsMagick.html#details-geometry
        } else {
          return gmfile
            .define('jpeg:preserve-settings')
            .compress('None')
            .quality(100)
        }
        // --------------------------------------------------------------
      }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(rename({ suffix: '-max' }))
      .pipe(gulp.dest(paths.img.web))
  } else {
    console.log('Colour profile _tools/profiles/' + colorProfile + ' not found. Exiting.')
    return
  }
  done()
})

// Minify JS files to make them smaller,
// using the drop_console option to remove console logging
gulp.task('js', function (done) {
  if (paths.js.src.length > 0) {
    console.log('Minifying Javascript')
    gulp.src(paths.js.src)
      .pipe(debug({ title: 'Minifying ' }))
      .pipe(uglify({ compress: { drop_console: true } }).on('error', function (e) {
        console.log(e)
      }))
      .pipe(rename({ suffix: '.min' }))
      .pipe(gulp.dest(paths.js.dest))
    done()
  } else {
    console.log('No scripts in source list to minify.')
    done()
  }
})

// Validate yaml files
gulp.task('yaml', function (done) {
  console.log('Checking YAML files...')

  gulp.src(paths.yaml.src)
    .pipe(tap(function (file) {
      try {
        yaml.safeLoad(fs.readFileSync(file.path, 'utf8'))
        console.log(file.basename + ' ✓')
      } catch (e) {
        console.log('') // empty line space
        console.log('\x1b[35m%s\x1b[0m', 'YAML error in ' + file.path + ':')
        console.log('\x1b[36m%s\x1b[0m', e.message)
        console.log('') // empty line space
      }
    }))
  done()
})

// When running `gulp`, do the image tasks by default.
gulp.task('default', gulp.series(
  'images:svg',
  'images:printpdf',
  'images:screenpdf',
  'images:epub',
  'images:app',
  'images:web',
  'images:small',
  'images:medium',
  'images:large',
  'images:xlarge'
))
