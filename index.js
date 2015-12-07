var through = require('through2');
var gutil = require('gulp-util');
var http = require('http');
var path = require('path');
var async = require('async');
var File = require('vinyl');

var debug = process.env.debug || process.env.DEBUG;

var defaultOptions = {
    cssFilename: 'fonts.css',
    fontsDir: './',
    cssDir: './',
    outBaseDir: ''
};

function verbose(msg) {
    if (debug) {
        process.stderr.write(msg + '\n');
    }
}


var template = [
    '@font-face {\n',
    '  font-family: "{{fontName}}";\n',
    '  font-style: {{fontStyle}};\n',
    '  font-weight: {{fontWeight}};\n',
    '  src: local("{{fontName}}"),\n',
    '       url("data:application/x-font-{{fontType}};base64,{{base64}}") format("{{fontType}}");\n',
    '}'
].join('');
module.exports = function() {
    'use strict';

    var transform = function(file, encoding, callback) {
        var self = this;
        if (file.isNull()) {
            return self.emit('data', file);
        }
        if (file.isStream()) {
            return self.emit('error', new Error('webfont-getter: Streaming not supported'));
        }

        var subsets = [];
        var data = file.contents.toString(encoding);

        var options = defaultOptions;
        var param = data
            .split('\n')
            .map(function(s) {
                return s.trim();
            })
            .filter(function(s) {
                return s.length > 0 && s.charAt(0) !== '#';
            })
            .map(parseLine)
            .join('|')
            .replace(/^\|*|\|*$/g, '');

        async.waterfall([initial(param), requestCss, receiveCss, parseCss, downloadFonts], callback);

        function parseLine(line) {
            if (line.indexOf('\t') === -1) {
                /* Extract subsets if specified */
                var ss = line.match(/&subset=.*$/);
                if (ss) {
                    line = line.substr(0, ss.index);
                    addSubsets(ss[0].substr(8).split(','));
                }
                return line.replace(/ /g, '+');
            } else {
                return parseTabDelimetedLine(line);
            }
        }

        function parseTabDelimetedLine(line) {
            var fields = line.split('\t');
            var face = fields[0].replace(/ /g, '+');
            var style = fields[1] || '400';
            var subset = fields[2];
            if (subset) {
                addSubsets(subset.split(','));
            }
            return face + ':' + style;
        }

        function addSubsets(s) {
            if (!s || !s.length) {
                return;
            }
            s.forEach(function(subset) {
                if (subsets.indexOf(subset) === -1) {
                    subsets.push(subset);
                }
            });
        }

        function initial(value) {
            return function(next) {
                return next(null, value);
            };
        }

        function requestCss(param, next) {
            if (subsets.length) {
                param = param + '&subset=' + subsets.join(',');
            }
            var req = {
                host: 'fonts.googleapis.com',
                path: '/css?family=' + param,
                headers: {
                    'User-Agent': 'Mozilla/4.0 (Windows NT 6.2; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/32.0.1667.0 Safari/537.36'
                }
            };
            verbose('GET ' + req.host + req.path);
            http
                .get(req, async.apply(next, null))
                .on('error', next);
        }

        function receiveCss(res, next) {
            var css = [];
            verbose('HTTP ' + res.statusCode);
            res.on('data', function(data) {
                css.push(data.toString());
            });
            res.on('error', next);
            res.on('end', function() {
                next(null, css.join(''));
            });
        }

        function parseCss(css, next) {
            css = css.replace(/\s*([{}:;\(\)])\s*/g, '$1');
            if (css.substr(0, 2) === '<!') {
                return next(new Error('Failed to retrieve webfont CSS'));
            }
            var rx = /@font-face{font-family:'([^']+)';font-style:(\w+);font-weight:(\w+);src:[^;]*url\(([^)]+\.woff)\)[^;]*;}/g;
            var requests = [];
            css.replace(rx, function(block, family, style, weight, url) {
                var name = [family, style, weight].join('-') + '.woff';
                requests.push({
                    family: family,
                    style: style,
                    weight: weight,
                    name: name.replace(/\s/g, '_'),
                    url: url
                });
            });
            generateFontCss(requests, next);
        }

        function generateFontCss(requests, next) {
            var template = [
                '@font-face {',
                '	font-family: \'$family\';',
                '	font-style: $style;',
                '	font-weight: $weight;',
                '	src: url($name) format(\'woff\');',
                '}'
            ].join('\n');
            var css = requests
                .map(makeFontFace)
                .join('\n\n');
            writeFile(path.join(options.cssDir, options.cssFilename), new Buffer(css), function(err) {
                next(err, requests);
            });

            function makeFontFace(request) {
                request.name = path.join(options.fontsDir, request.name);
                return template
                    .replace(/\$(\w+)/g, function(m, name) {
                        return request[name];
                    });
            }
        }

        function writeFile(filename, contents, next) {
            if (options.outBaseDir) {
                filename = path.join(options.outBaseDir, filename);
            }
            verbose('Writing ' + contents.length + ' bytes to "' + filename + '"');

            processFiles(filename, contents, next);
            //writeFileToGulpStream(filename, contents, next);

            return;

            function writeFileToGulpStream(filename, contents, next) {
                self.push(new File({
                    path: filename,
                    contents: contents
                }));
                next(null, null);
            }
        }

        function downloadFonts(requests) {
            async.each(requests, downloadFont, callback);

            function downloadFont(request, next) {
                async.waterfall([initial(request), requestFont, emitFont], next);

                function requestFont(obj, next) {
                    http
                        .get(obj.url, async.apply(next, null, obj.name))
                        .on('error', next);
                }

                function emitFont(name, res, next) {
                    if (res.statusCode !== 200) {
                        next(new Error('HTTP GET returned code ' + res.statusCode + ' for ' + name));
                        return;
                    }
                    var data = [];
                    res.on('data', function(chunk) {
                        data.push(chunk);
                    });
                    res.on('end', function() {
                        writeFile(name, Buffer.concat(data), next);
                    });
                }
            }
        }

        function processFiles(filename, contents, next) {
            //gutil.log(filename);
            var regexResult = filename.match(/(.+).(woff|woff2)\b/);
            if (regexResult) {
                var fileName = regexResult[1];
                var fontType = regexResult[2];
                var fontData = fileName.split('-');
                //gutil.log(fontData);
                var fontName = fontData[0].replace(/_/g, ' ');
                var fontStyle = fontData[1];
                var fontWeight = fontData[2];
                var base64 = contents.toString('base64');
                var tmpl = template
                    .replace(/{{fontName}}/g, fontName)
                    .replace(/{{fontType}}/g, fontType)
                    .replace(/{{fontStyle}}/g, fontStyle)
                    .replace(/{{fontWeight}}/g, fontWeight)
                    .replace('{{base64}}', base64);
                var output = new gutil.File({
                    path: fileName + '.css'
                });

                output.contents = new Buffer(tmpl);
                //gutil.log(tmpl);
                self.push(output);
            }
            //this.push(output);

            next(null, null);
        }

    };

    return through.obj(transform);
};
