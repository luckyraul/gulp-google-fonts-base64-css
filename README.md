# gulp-google-fonts-base64-css
Gulp plugin to generate css files with Base64 encoded font data from Google Fonts

inspired by https://github.com/ygoto3/gulp-base64-webfont-css and https://github.com/battlesnake/gulp-google-webfonts


# Example   

### fonts.list

```
# Google format
Roboto:500,500italic&subset=greek
```

### gulpfile.js

```
var gulp = require('gulp');
var concat = require('gulp-concat');
var cssmin = require('gulp-minify-css');
var webFontsBase64 = require('gulp-google-fonts-base64-css');
	
gulp.task('fonts', function () {
	return gulp.src('./fonts.list')
      .pipe(webFontsBase64())
      .pipe(concat('web-fonts.css'))
      .pipe(cssmin())
      .pipe(gulp.dest('./css'));
});
```

## Output
```
@font-face {
  font-family: "Roboto";
  font-style: normal;
  font-weight: 500;
  src: local("Roboto"),
    url("data:application/x-font-woff;base64,{{base64}}") format("woff");
}
@font-face {
  font-family: "Roboto";
  font-style: italic;
  font-weight: 500;
  src: local("Roboto"),
    url("data:application/x-font-woff;base64,{{base64}}") format("woff");
}
...
and others

```
