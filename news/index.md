---
title: News
nav:
  order: 4
  tooltip: Updates and archive
---

# {% include icon.html icon="fa-solid fa-newspaper" %}News


{% include section.html %}

{% include search-box.html %}

{% include tags.html tags=site.tags %}

{% include search-info.html %}

{% include list.html data="posts" component="post-excerpt" filters="category: news" %}
