---
---

{% capture text %}

Welcome to the BioM2 lab in the [Department of Ecology and Evolutionary Biology at Cornell](https://ecologyandevolution.cornell.edu/)! We use both _in situ_ and _in silico_ approaches to understand principles underlying diversity and heterogeneity in forest ecosystems and how these principles drive spatial and temporal dynamics of the terrestrial biosphere. Particularly, we adopt a [ModEx](https://ess.science.energy.gov/modex/) approach that integrates process-based modeling and model-guided experiments. We also investigate ecological patterns emerging from novel multi-scale remote sensing products with machine learning.

Reach out for research opportunities **[HERE](./team)**!

{% endcapture %}

{%
  include feature.html
  image="images/lab_logo_wide.png"
  link="research"
  title="Predicting Dynamics From Individual Tree to Landscape"
  text=text
%}



{% include section.html %}

# Latest News

{% capture content %}
<!-- only include the most recent 6 news -->
{% include latest_list.html data="posts" component="post-excerpt" filters="category: news" limit=6 %}
{% endcapture %}
{% include grid.html content=content %}
