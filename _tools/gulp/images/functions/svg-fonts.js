// This function makes fonts display correctly, by doing three things:
// - adding a style element that imports Google fonts (skipped for epub,
//   where remote resources are not allowed by EPUBCheck)
// - replacing 'Asap-Medium' with 'Asap', font-weight 600
// - replacing 'Asap-Regular' with 'Asap'

function svgFonts(xml, outputFormat) {

    // The @import is a remote resource, which is invalid in epub.
    if (outputFormat !== 'epub') {
        xml.svg.defs = {
            style: '@import url("https://fonts.googleapis.com/css?family=Asap:400,400i,600,600i");'
        };
    }

    // Initialise a list of text elements
    var svgTextElements = [];

    // Add text elements in g elements`recursively
    // to the svgTextElements array.
    function addGText(element) {
        var gElements = element.g;

        gElements.forEach(function (g) {
            var gTextElements = g.text;
            if (gTextElements) {
                gTextElements.forEach(function (gTextElement) {
                    svgTextElements.push(gTextElement);
                });
            }

            // If g contains another g, recur
            if (g.g) {
                addGText(g);
            }
        });
    }
    addGText(xml.svg);

    var fontReplacements = {
        "font-family:'Asap-Regular';": "font-family:'Asap';",
        "font-family:'Asap-Medium';": "font-family:'Asap';font-weight:600;"
    }

    svgTextElements.forEach(function (element) {
        var styleString = element.$.style;
        for (var string in fontReplacements) {
            if (styleString.includes(string)) {
                styleString = styleString.replace(string, fontReplacements[string]);
                element.$.style = styleString;
            }
        }
    });

    return xml;
}

exports.svgFonts = svgFonts;
