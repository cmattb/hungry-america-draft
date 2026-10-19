// Find food near you: ZIP code search over the Food Security Network list.
// Everything runs in the browser. Programs come from /data/fsn-programs.json;
// ZIP code centers come from /data/zip/<first three digits>.json (Census ZCTA centroids).
(function () {
  "use strict";

  var PAGE = 20;          // programs shown per page of results
  var RADIUS = 50;        // miles
  var MIN_NEARBY = 5;     // if fewer than this are within RADIUS, show the nearest few anyway
  var FALLBACK = 10;
  var BASE = document.documentElement.getAttribute("data-base") || "";  // the site's address prefix, e.g. on GitHub Pages

  var zipForm = document.getElementById("zip-form");
  var zipInput = document.getElementById("zip");
  var zipError = document.getElementById("zip-error");
  var stateForm = document.getElementById("state-form");
  var stateSelect = document.getElementById("state");
  var stateError = document.getElementById("state-error");
  var heading = document.getElementById("results-heading");
  var statusEl = document.getElementById("status");
  var distanceNote = document.getElementById("distance-note");
  var list = document.getElementById("results");
  var moreBtn = document.getElementById("more");
  if (!zipForm) return;

  var programsRequest = null;  // one download of the program list, shared by every search
  var searchCount = 0;         // each search gets a number; only the latest one may change the page
  var current = [];
  var shown = 0;
  var summary = "";

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  function loadPrograms() {
    if (!programsRequest) {
      programsRequest = getJSON(BASE + "/data/fsn-programs.json").catch(function (err) {
        programsRequest = null;  // let the next search try again
        throw err;
      });
    }
    return programsRequest;
  }

  function loadCenters(zip) {
    return getJSON(BASE + "/data/zip/" + zip.slice(0, 3) + ".json").catch(function (err) {
      if (err.message === "404") return {};  // no ZIP code starts with these three digits
      throw err;
    });
  }

  function miles(lat1, lng1, lat2, lng2) {
    var toRad = Math.PI / 180, R = 3958.8;
    var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text) e.textContent = text;
    return e;
  }

  // Web addresses, email addresses, and (in the Phone field) phone numbers inside listing text become links.
  // build.py uses the same patterns. No lookbehind: older phones can't run it.
  var LINK_RE = /((?:https?:\/\/|www\.)[^\s<>"]+)|([A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,})|((?:\+?1[\s.\-]?)?\(?[0-9]{3}\)?[\s.\-]*[0-9A-Z]{3}[\s.\-]*[0-9A-Z]{4}(?![A-Za-z0-9_\-]))/g;
  var KEYPAD = { A: 2, B: 2, C: 2, D: 3, E: 3, F: 3, G: 4, H: 4, I: 4, J: 5, K: 5, L: 5, M: 6,
    N: 6, O: 6, P: 7, Q: 7, R: 7, S: 7, T: 8, U: 8, V: 8, W: 9, X: 9, Y: 9, Z: 9 };

  function telHref(number) {
    var digits = number.replace(/[A-Z]/g, function (ch) { return String(KEYPAD[ch]); }).replace(/[^0-9]/g, "");
    if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
    return digits.length === 10 ? "tel:+1" + digits : null;
  }

  function linkParts(text, phones) {
    var parts = [], pos = 0, m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(text)) !== null) {
      var start = m.index, end = start + m[0].length, href = null;
      if (m[1]) {
        var url = m[1].replace(/[.,;:!?'")\]]+$/, "");
        end = start + url.length;
        href = url.indexOf("http") === 0 ? url : "https://" + url;
      } else if (m[2]) {
        href = "mailto:" + m[2];
      } else if (phones && (start === 0 || !/[A-Za-z0-9_\-]/.test(text.charAt(start - 1)))) {
        href = telHref(m[3]);
      }
      if (!href) continue;
      parts.push([text.slice(pos, start), null], [text.slice(start, end), href]);
      pos = end;
    }
    parts.push([text.slice(pos), null]);
    return parts.filter(function (p) { return p[0]; });
  }

  function appendLinked(parent, text, phones) {
    linkParts(text, phones).forEach(function (p) {
      parent.appendChild(p[1] ? el("a", { href: p[1] }, p[0]) : document.createTextNode(p[0]));
    });
  }

  // kind: "plain" (no links), "phone", or "text"
  function addRow(dl, label, value, kind) {
    if (!value) return;
    dl.appendChild(el("dt", null, label));
    var dd = el("dd");
    if (kind === "plain") dd.textContent = value; else appendLinked(dd, value, kind === "phone");
    dl.appendChild(dd);
  }

  function programItem(p) {
    var li = el("li", { "class": "program" });
    var art = el("article");
    art.appendChild(el("h3", null, p.name));
    art.appendChild(el("p", { "class": "type" }, p.type));
    var dl = el("dl");
    if (typeof p.distance === "number") {
      addRow(dl, "Distance", "About " + (p.distance < 10 ? p.distance.toFixed(1) : Math.round(p.distance)) + " miles away", "plain");
    }
    addRow(dl, "Address", p.address, "plain");
    addRow(dl, "Phone", p.phone, "phone");
    addRow(dl, "Hours", p.hours, "text");
    addRow(dl, "Who can get food", p.eligibility, "text");
    addRow(dl, "Accessibility", p.accessibility, "text");
    art.appendChild(dl);
    var links = el("p");
    var parts = [];
    if (/^https?:/.test(p.website)) parts.push(el("a", { href: p.website }, "Website"));
    if (/^https?:/.test(p.contact) && p.contact !== p.website) parts.push(el("a", { href: p.contact }, "Contact page"));
    if (p.address) parts.push(el("a", { href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.address) }, "Directions"));
    parts.forEach(function (a, i) { if (i) links.appendChild(document.createTextNode(" · ")); links.appendChild(a); });
    art.appendChild(links);
    if (p.services || p.social) {
      var det = el("details");
      det.appendChild(el("summary", null, "More about this program"));
      [p.services, p.social].forEach(function (t) {
        if (!t) return;
        var para = el("p");
        appendLinked(para, t, false);
        det.appendChild(para);
      });
      art.appendChild(det);
    }
    li.appendChild(art);
    return li;
  }

  function showStatus() {
    statusEl.textContent = summary + (current.length > PAGE ? " Showing " + shown + " of " + current.length + "." : "");
  }

  function showPage() {
    var next = current.slice(shown, shown + PAGE);
    next.forEach(function (p) { list.appendChild(programItem(p)); });
    shown += next.length;
    moreBtn.hidden = shown >= current.length;
    showStatus();
  }

  function clearResults() {
    list.innerHTML = "";
    current = []; shown = 0; summary = "";
    heading.hidden = true;
    distanceNote.hidden = true;
    moreBtn.hidden = true;
    statusEl.textContent = "";
  }

  function showResults(items, message) {
    clearResults();
    current = items;
    summary = message;
    heading.hidden = false;
    distanceNote.hidden = false;
    showPage();
    heading.focus();
  }

  // badInput marks the ZIP box itself as wrong; a download failure doesn't.
  function setError(msg, badInput) {
    zipError.textContent = msg;
    if (msg && badInput) zipInput.setAttribute("aria-invalid", "true");
    else zipInput.removeAttribute("aria-invalid");
  }

  function searchZip(zip) {
    var mine = ++searchCount;
    clearResults();
    setError("", false);
    if (!/^[0-9]{5}$/.test(zip)) {
      setError("Enter a five-digit ZIP code.", true);
      zipInput.focus();
      return;
    }
    statusEl.textContent = "Searching…";
    Promise.all([loadPrograms(), loadCenters(zip)])
      .then(function (res) {
        if (mine !== searchCount) return;  // a newer search has started
        var all = res[0], c = res[1][zip];
        if (!c) {
          statusEl.textContent = "";
          setError("We couldn’t find ZIP code " + zip + ". Try a nearby ZIP code, or choose a state.", true);
          zipInput.focus();
          return;
        }
        var withDist = all.filter(function (p) { return typeof p.lat === "number" && typeof p.lng === "number"; })
          .map(function (p) { var q = Object.assign({}, p); q.distance = miles(c[0], c[1], p.lat, p.lng); return q; })
          .sort(function (a, b) { return a.distance - b.distance; });
        var near = withDist.filter(function (p) { return p.distance <= RADIUS; });
        if (near.length >= MIN_NEARBY) {
          showResults(near, near.length + " programs within " + RADIUS + " miles of " + zip + ", nearest first.");
        } else {
          var few = withDist.slice(0, FALLBACK);
          var lead = near.length === 0 ? "No programs in the list are within " + RADIUS + " miles of " + zip + ". "
            : "Only " + near.length + (near.length === 1 ? " program is" : " programs are") + " within " + RADIUS + " miles of " + zip + ". ";
          showResults(few, lead + "These are the " + few.length + " nearest.");
        }
        if (window.history && history.replaceState) history.replaceState(null, "", "?zip=" + zip);
      })
      .catch(function () {
        if (mine !== searchCount) return;
        statusEl.textContent = "";
        setError("Something went wrong loading the list. Please try again, or browse by state below.", false);
      });
  }

  zipForm.addEventListener("submit", function (e) {
    e.preventDefault();
    searchZip(zipInput.value.trim());
  });

  moreBtn.addEventListener("click", function () {
    var first = shown;
    showPage();
    var items = list.querySelectorAll("li.program h3");
    if (items[first]) { items[first].setAttribute("tabindex", "-1"); items[first].focus(); }
  });

  stateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!stateSelect.value) {
      stateError.textContent = "Choose a state.";
      stateSelect.setAttribute("aria-invalid", "true");
      stateSelect.focus();
      return;
    }
    stateError.textContent = "";
    stateSelect.removeAttribute("aria-invalid");
    window.location.href = BASE + "/find-food/state/" + stateSelect.value.toLowerCase() + "/";
  });

  // The forms work only with this script, so they appear only once it is running.
  zipForm.hidden = false;
  stateForm.hidden = false;

  var params = new URLSearchParams(window.location.search);
  if (params.get("state")) {
    window.location.replace(BASE + "/find-food/state/" + params.get("state").toLowerCase().replace(/[^a-z]/g, "") + "/");
  } else if (params.get("zip")) {
    zipInput.value = params.get("zip").slice(0, 5);
    searchZip(zipInput.value);
  }
})();
