// This function makes fonts display correctly, by doing three things:
// - adding a style element that imports Google fonts (skipped for epub,
//   where remote resources are not allowed by EPUBCheck)
// - replacing 'Asap-Medium' with 'Asap', font-weight 500
// - replacing 'Asap-Regular' with 'Asap'

function svgFonts(xml, outputFormat) {

    // The @import is a remote resource, which is invalid in epub.
    if (outputFormat !== 'epub') {
        var defs = xml.svg.defs || {};
        var style = '@import url("https://fonts.googleapis.com/css?family=Asap:400,400i,500,500i,600,600i");';
        if (!defs.style) {
            defs.style = style;
        } else if (!defs.style.includes(style)) {
            if (Array.isArray(defs.style)) {
                defs.style.push(style);
            } else {
                defs.style = [defs.style, style];
            }
        }
        xml.svg.defs = defs;
    }

    // Initialise a list of text elements
    var svgTextElements = [];

    // Add text elements in g elements recursively
    // and also add text elements directly in the SVG.
    function addGText(element) {
        var gElements = element.g;
        if (!gElements) {
            return;
        }

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
    
    // Also add text elements directly in the svg element
    if (xml.svg.text) {
        xml.svg.text.forEach(function (textElement) {
            svgTextElements.push(textElement);
        });
    }

    svgTextElements.forEach(function (element) {
        if (!element.$ || !element.$.style) {
            return;
        }
        var styleString = element.$.style;
        // Replace Asap font variant names with 'Asap'. SVGO minifies fonts like:
        // font-family:Asap-Regular,Asap or font-family:'Asap-Medium',sans-serif
        // Match the font name and any following comma and spaces, but stop at the next property.
        styleString = styleString.replace(/font-family:\s*['"]?Asap-Regular['"]?\s*,?\s*Asap\b/g, "font-family:'Asap'");
        styleString = styleString.replace(/font-family:\s*['"]?Asap-Medium['"]?\s*,?\s*Asap\b/g, "font-family:'Asap';font-weight:500");
        element.$.style = styleString;
    });

    return xml;
}

exports.svgFonts = svgFonts;
