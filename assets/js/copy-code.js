(function () {
  var COPY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2"></rect>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  var CHECK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 6 9 17l-5-5"></path></svg>';

  function languageOf(block) {
    var match = /language-([\w-]+)/.exec(block.className);
    if (!match || match[1] === "plaintext") return "code";
    return match[1];
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (err) {
        reject(err);
      }
      document.body.removeChild(area);
    });
  }

  function addToolbar(block) {
    var code = block.querySelector("pre");
    if (!code) return;

    var toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";

    var lang = document.createElement("span");
    lang.className = "code-toolbar__lang";
    lang.textContent = languageOf(block);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.setAttribute("aria-label", "Copy code to clipboard");
    button.innerHTML = COPY_ICON + "<span>Copy</span>";

    var timer;
    button.addEventListener("click", function () {
      copyText(code.innerText.replace(/\n$/, "")).then(
        function () {
          button.classList.add("is-copied");
          button.innerHTML = CHECK_ICON + "<span>Copied</span>";
          clearTimeout(timer);
          timer = setTimeout(function () {
            button.classList.remove("is-copied");
            button.innerHTML = COPY_ICON + "<span>Copy</span>";
          }, 1800);
        },
        function () {
          button.innerHTML = COPY_ICON + "<span>Press Ctrl+C</span>";
          var range = document.createRange();
          range.selectNodeContents(code);
          var selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      );
    });

    toolbar.appendChild(lang);
    toolbar.appendChild(button);
    block.insertBefore(toolbar, block.firstChild);
  }

  var blocks = document.querySelectorAll("div.highlighter-rouge, figure.highlight");
  for (var i = 0; i < blocks.length; i++) addToolbar(blocks[i]);
})();
