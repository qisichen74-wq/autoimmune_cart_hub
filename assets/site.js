(function () {
  "use strict";
  // 排序只加在**行数等于总数**的表上。这个判据由服务端的 sortable_head() 把关
  // （行数 != 总数就 raise），这里只认它打下的标记。
  // 为什么这条准入是硬的：render.py 里有十几处"共 N 项，上表只列最近 N 条"。
  // 给一张已截断的表加排序，等于把本项目的头号失效模式做成功能 ——
  // 读者点"入组数"降序，看到的"最大的几项"只是那二十行里最大的几项，
  // 而页面不会说这件事。
  var MARK = "data-s";

  function cells(tb) { return Array.prototype.slice.call(tb.rows); }

  function keyOf(tr, i, kind) {
    var td = tr.cells[i];
    var t = td ? (td.textContent || "").replace(/\s+/g, " ").trim() : "";
    if (kind === "num") {
      // 数值格里常带单位与副行（例如"24（计划）"），取第一个数。
      var m = t.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
      // ⚠️ 取不到数时排在最后（升序也最后）：把"没有这个数"排到最前，
      //    会让一张按入组数排的表以一串空值开头，读起来像"最小的几项"。
      return m ? parseFloat(m[0]) : null;
    }
    return t;
  }

  function cmp(a, b) {
    if (a === null && b === null) { return 0; }
    if (a === null) { return 1; }      // 缺值恒排最后，与方向无关
    if (b === null) { return -1; }
    if (typeof a === "number") { return a - b; }
    return a.localeCompare(b, "zh-Hans-CN");
  }

  function claimNode(table) {
    // 行序声明：同一节里带 data-default 的那个节点。找不到就**不启用排序**，
    // 而不是悄悄排一下 —— 没有地方可以改写那句话时，排序会让页面说假话。
    var sec = table.closest("section") || table.ownerDocument;
    return sec.querySelector("[data-default]");
  }

  function sortTable(table, idx, kind, dir, claim) {
    var tb = table.tBodies[0];
    if (!tb) { return; }
    var rs = cells(tb);
    rs.forEach(function (tr, i) {
      if (tr.getAttribute("data-i") === null) { tr.setAttribute("data-i", String(i)); }
    });
    if (dir === 0) {
      rs.sort(function (x, y) {
        return parseInt(x.getAttribute("data-i"), 10) - parseInt(y.getAttribute("data-i"), 10);
      });
    } else {
      rs.sort(function (x, y) {
        return dir * cmp(keyOf(x, idx, kind), keyOf(y, idx, kind));
      });
    }
    rs.forEach(function (tr) { tb.appendChild(tr); });
    if (claim) {
      var label = table.tHead.rows[0].cells[idx].textContent.replace(/\s+/g, " ").trim();
      if (dir === 0) {
        claim.textContent = claim.getAttribute("data-default");
      } else {
        claim.textContent = "已按「" + label + "」"
          + (dir > 0 ? "升序" : "降序") + "重排。页面默认的行序见「复位」。";
      }
    }
  }

  function wire(table) {
    var ths = Array.prototype.slice.call(table.querySelectorAll("th[" + MARK + "]"));
    if (!ths.length) { return; }
    var claim = claimNode(table);
    var state = { idx: -1, dir: 0 };

    function paint() {
      ths.forEach(function (th) {
        var own = th.cellIndex === state.idx && state.dir !== 0;
        th.setAttribute("aria-sort", own ? (state.dir > 0 ? "ascending" : "descending") : "none");
      });
    }

    ths.forEach(function (th) {
      var kind = th.getAttribute(MARK);
      var txt = th.textContent;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "srt";
      btn.textContent = txt;
      th.textContent = "";
      th.appendChild(btn);
      th.setAttribute("aria-sort", "none");
      btn.addEventListener("click", function () {
        var i = th.cellIndex;
        // 同一列三态循环：升 -> 降 -> 回到页面默认行序。
        // ⚠️ 第三态不是"再升一次"：读者必须能回到那句行序声明描述的状态，
        //    否则页面上那句话与眼前的表永远对不上。
        if (state.idx !== i) { state = { idx: i, dir: 1 }; }
        else if (state.dir === 1) { state.dir = -1; }
        else if (state.dir === -1) { state = { idx: -1, dir: 0 }; }
        else { state = { idx: i, dir: 1 }; }
        sortTable(table, i, kind, state.dir, claim);
        paint();
      });
    });

    if (claim) {
      var reset = document.createElement("button");
      reset.type = "button";
      reset.className = "srt";
      reset.textContent = "复位";
      reset.addEventListener("click", function () {
        state = { idx: -1, dir: 0 };
        sortTable(table, 0, "text", 0, claim);
        paint();
      });
      claim.parentNode.appendChild(document.createTextNode(" "));
      claim.parentNode.appendChild(reset);
    }
  }

  // ===== 筛选与检索（B12）=====
  // ⚠️ **只有这一个函数会隐藏东西**，而它在同一次调用的末尾写分母。
  //    两者由同一个 for 循环的同一个计数器产出，所以"分母"与"可见数"
  //    在结构上不可能漂开。守这件事的是
  //    test_the_js_has_exactly_one_place_that_hides_a_row。
  // ⚠️ 分母的**总数**取自服务端渲染的 data-total，JS 不自己数一遍：
  //    页面上别处印着"共 N 项"，两处各算一次的那天它们会对不上。
  function applyFilter(bar) {
    var total = parseInt(bar.getAttribute("data-total"), 10);
    var items = bar.__items;
    var active = {};
    var any = false;
    Array.prototype.slice.call(bar.querySelectorAll("button[data-k]")).forEach(function (b) {
      if (b.getAttribute("aria-pressed") !== "true") { return; }
      var k = b.getAttribute("data-k");
      (active[k] = active[k] || []).push(b.getAttribute("data-v"));
      any = true;
    });
    var q = bar.__input ? bar.__input.value.trim().toLowerCase() : "";
    var m = 0;
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var ok = true;
      for (var k in active) {
        // ⚠️ 一律按 token 列表求交，不用相等匹配：靶点这类维度是**多值**的
        //    （一项双靶试验的 data-tgt 是 "BCMA CD19"）。用相等匹配的后果是
        //    筛 CD19 时双靶试验一条都不出现 —— 而那不报错，只是少了一批。
        var own = (el.getAttribute("data-" + k) || "").split(" ");
        var any2 = false;
        for (var j = 0; j < active[k].length; j++) {
          if (own.indexOf(active[k][j]) >= 0) { any2 = true; break; }
        }
        if (!any2) { ok = false; break; }
      }
      if (ok && q) {
        if (el.__txt === undefined) {
          el.__txt = (el.textContent || "").replace(/\s+/g, " ").toLowerCase();
        }
        ok = el.__txt.indexOf(q) >= 0;
      }
      el.hidden = !ok;
      if (ok) { m++; }
    }
    var out = bar.querySelector(".flt-n");
    if (!out) { return; }
    if (!any && !q) {
      out.textContent = "未筛选 · 全部 " + total + " 项可见";
      return;
    }
    out.textContent = (out.getAttribute("data-tpl") || "")
      .replace("{m}", String(m)).replace("{n}", String(total));
    if (m === 0) {
      // ⚠️ 0 结果不许只写一句"暂无"。本页索引的是什么、没索引的是什么，
      //    必须在这里说出来 —— 否则"这里搜不到"会被读成"本站没有"。
      out.textContent += "。没有条目同时满足这些条件" + (q ? "且包含「" + q + "」" : "")
        + "。本页检索只看**本页已列出**的条目的文字（NCT 号、标题、病名、申办方），"
        + "不含被截断没列出的、也不含文献与交易板块 —— 清除筛选可恢复全部 "
        + total + " 项。";
    }
  }

  function wireFilter(bar) {
    // 目标集合：本页所有带 data-kind 的条目（卡片或行）。
    // ⚠️ 用通用标记 data-f 收条目，不按具体维度名收：事件页的卡分散在四个分组里、
    //    试验页的行在一张表里，两处的维度也不同（kind/pri/spon vs status/phase/spon）。
    //    按维度名收的下一步就是每加一个页面都要来改这一行。
    bar.__items = Array.prototype.slice.call(document.querySelectorAll("[data-f]"));
    if (!bar.__items.length) { return; }   // 没有可筛的东西就**不显示控件**
    bar.__input = bar.querySelector("input[data-find]");
    bar.removeAttribute("hidden");
    Array.prototype.slice.call(bar.querySelectorAll("button[data-k]")).forEach(function (b) {
      if (b.disabled) { return; }
      b.addEventListener("click", function () {
        b.setAttribute("aria-pressed",
          b.getAttribute("aria-pressed") === "true" ? "false" : "true");
        applyFilter(bar);
      });
    });
    if (bar.__input) {
      bar.__input.addEventListener("input", function () { applyFilter(bar); });
      bar.__input.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") { clearAll(bar); }
      });
    }
    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "srt";
    clear.textContent = "清除筛选（Esc）";
    clear.addEventListener("click", function () { clearAll(bar); });
    bar.querySelector(".flt-n").appendChild(document.createTextNode("　"));
    bar.querySelector(".flt-n").appendChild(clear);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { clearAll(bar); }
    });
  }

  function clearAll(bar) {
    Array.prototype.slice.call(bar.querySelectorAll("button[data-k]")).forEach(function (b) {
      b.setAttribute("aria-pressed", "false");
    });
    if (bar.__input) { bar.__input.value = ""; }
    applyFilter(bar);
  }

  document.addEventListener("DOMContentLoaded", function () {
    Array.prototype.slice.call(document.querySelectorAll("table")).forEach(wire);
    Array.prototype.slice.call(document.querySelectorAll(".flt")).forEach(wireFilter);
  });
})();
