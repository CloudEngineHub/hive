#!/usr/bin/env python3
"""
Extract reactor profile URLs and names from a saved LinkedIn reactions dialog HTML file.
Usage: python3 extract_reactors.py <html_file>
"""
import re, sys, json

filepath = sys.argv[1]
html = open(filepath).read()

# Find all links inside the reactions dialog that point to LinkedIn profiles
# Pattern: href="/in/slug" with name text nearby
# LinkedIn profile links in the reactions modal
pattern = r'href="(https://www\.linkedin\.com/in/[^"?]+)[^"]*"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)'

# Alternative: look for /in/ slugs directly
slug_pattern = r'href="(/in/([^"?/]+)[^"]*?)"'
slugs = re.findall(slug_pattern, html)

# Also try to extract names from the accessibility labels
name_pattern = r'aria-label="([^"]+?)\s+reacted\s+with\s+(\w+)'
names_reactions = re.findall(name_pattern, html)

# Build a map from slug -> name using proximity
results = []
seen = set()

# Method 1: Find all profile links with their adjacent text
# Pattern: <a href="/in/slug..."> ... name text ...
link_pattern = r'<a[^>]*href="(/in/([^"?/]+)[^"]*)"[^>]*>(.*?)</a>'
for match in re.finditer(link_pattern, html, re.DOTALL):
    slug_path = match.group(1).split('?')[0]
    slug_name = match.group(2)
    inner_html = match.group(3)
    
    # Extract display name from inner text
    text = re.sub(r'<[^>]+>', ' ', inner_html)
    text = re.sub(r'\s+', ' ', text).strip()
    
    # Usually the first part before • is the name
    name = text.split('•')[0].strip() if '•' in text else text.split('reacted')[0].strip()
    
    if slug_path not in seen and name and len(name) > 1:
        seen.add(slug_path)
        profile_url = f"https://www.linkedin.com{slug_path}"
        results.append({
            "name": name,
            "profile_url": profile_url,
            "slug": slug_name
        })

# Output as JSON
print(json.dumps(results, indent=2, ensure_ascii=False))
print(f"\n--- {len(results)} unique profiles extracted ---", file=sys.stderr)
