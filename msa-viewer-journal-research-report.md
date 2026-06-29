# Bioinformatics Journal Manuscript Type Research Report
## For: MSA Viewer Software Paper
### Date: June 2026

---

## 1. JOURNAL REQUIREMENTS COMPARISON

### 1.1 Bioinformatics (Oxford University Press)

| Attribute | Application Note | Original Paper |
|-----------|-----------------|----------------|
| **Page limit** | **4 pages** (journal template, ~2,600 words or ~2,000 words + 1 figure) | **7 pages** (journal template) |
| **Purpose** | Short descriptions of novel software tools, databases, web servers, or new algorithm implementations | Novel methods, algorithms with substantial validation and benchmarking |
| **Abstract** | Short (typically unlabeled, ~150 words) | Structured abstract required |
| **Figures/Tables** | 1-2 figures typical | Multiple figures and tables |
| **Supplementary** | Allowed but limited | Extensive supplementary allowed |
| **Peer Review** | Yes (typically faster) | Yes (full review) |
| **Open Access** | Yes (fully OA journal) | Yes |
| **Impact Factor** | ~6.0 (2024) | Same |
| **Template** | LaTeX or Word via OUP portal | Same |

**Key requirements for Application Notes:**
- Novel software or new implementation required
- Software must be freely available (academic use minimum)
- Source code link mandatory
- Must describe what the tool does, why it's novel, and show a use case
- The word limit is tight: ~2,000 words of text plus one figure

**Key requirements for Original Papers:**
- Must present genuinely new algorithms or substantial advances
- Rigorous benchmarking against existing methods
- Statistical validation of results
- More detailed methods section required

### 1.2 Nucleic Acids Research (NAR) — Web Server Issue

| Attribute | Web Server Article |
|-----------|-------------------|
| **Page limit** | **2-4 printed pages** (~2,000-4,000 words) |
| **Pre-submission** | **One-page summary** must be sent to Editor (Dr. Gary Benson) by ~**December 20** for pre-approval |
| **Timeline** | Annual issue (July publication); miss the Dec 20 deadline = wait 1 full year |
| **Requirement** | **Must be a functional, publicly accessible web server** — NOT a downloadable tool |
| **Format** | Brief structured paper describing the server's function and implementation |
| **Peer Review** | Yes, competitive (74 servers published in 2024 issue) |
| **Impact Factor** | ~16.0 (2024) |
| **Open Access** | Yes |
| **Novelty bar** | High — must justify why a new server is needed |
| **Evidence** | User statistics, server uptime, validation examples needed |

**Key constraint:** NAR Web Server Issue ONLY accepts web-based tools. If MSA Viewer has a server component but also a desktop component, the server must be the primary focus. The December pre-approval cycle adds a hard deadline. This is the most prestigious venue among the three but also the most restrictive.

### 1.3 BMC Bioinformatics — Software Article

| Attribute | Software Article |
|-----------|-----------------|
| **Page limit** | **No strict limit** (full article format) |
| **Format** | Full research article: Abstract, Background, Implementation, Results, Discussion, Conclusions |
| **Abstract** | Structured abstract (~350 words) required |
| **Source code** | Must be deposited in a public repository with open-source license |
| **Availability** | "Availability of data and materials" statement mandatory |
| **Peer Review** | Full peer review, typically 2-3 reviewers |
| **Open Access** | Yes (APC: ~$2,990 USD) |
| **Impact Factor** | ~3.0 (2024) |
| **Template** | BMC Word/LaTeX template |
| **Figures** | No hard limit, publication-quality required |
| **Supplementary** | Unlimited supplementary files |

**Key requirement:** Software must be open-source with a recognized license. Must demonstrate utility through use cases. Can include benchmarks and comparisons. The article processing charge is significant.

---

## 2. SIMILAR PUBLICATIONS (2020-2025 Context)

### 2.1 Core MSA Viewer/Tool Publications

| # | Title | Authors | Journal | Year | Type | Pages | Citations |
|---|-------|---------|---------|------|------|-------|-----------|
| 1 | **Jalview Version 2—a multiple sequence alignment editor and analysis workbench** | Waterhouse, Procter, Martin, Clamp, Barton | Bioinformatics | 2009 | Application Note | 3pp (25:1189-1191) | ~3,000+ |
| 2 | **AliView: a fast and lightweight alignment viewer and editor for large datasets** | Larsson, A. | Bioinformatics | 2014 | Application Note | 3pp (30:3276-3278) | ~2,000+ |
| 3 | **Unipro UGENE: a unified bioinformatics toolkit** | Okonechnikov, Golosova, Fursov, UGENE team | Bioinformatics | 2012 | Application Note | 2pp (28:1166-1167) | ~3,900+ |
| 4 | **MSAViewer: interactive JavaScript visualization of multiple sequence alignments** | Yachdav, Wilzbach, Rauscher, Sheridan, et al. | Bioinformatics | 2016 | Application Note | 3pp (32:3501-3503) | ~300+ |
| 5 | **ProSeqViewer: an interactive, responsive and efficient TypeScript viewer for sequence annotations** | Karczewski, et al. | Bioinformatics | 2022 | Application Note | 3pp (38:1129-1131) | Recent |
| 6 | **MView: a web-compatible database search or multiple alignment viewer** | Brown, Leroy, Sander | Bioinformatics | 1998 | Application Note | 2pp (14:380-381) | ~700+ |
| 7 | **SeaView Version 4: A Multiplatform Graphical User Interface for Sequence Alignment and Phylogenetic Tree Building** | Gouy, Guindon, Gascuel | Mol. Biol. Evol. | 2010 | Full Article | 4pp (27:221-224) | ~6,800+ |
| 8 | **MEGA12: Molecular Evolutionary Genetic Analysis Version 12** | Kumar, Stecher, et al. | Mol. Biol. Evol. | 2024 | Full Article | 6pp | Recent |
| 9 | **MAFFT Multiple Sequence Alignment Software Version 7** | Katoh, Standley | Mol. Biol. Evol. | 2013 | Full Article | 9pp (30:772-780) | ~25,000+ |
| 10 | **Clustal Omega: Fast, scalable generation of high-quality protein MSAs** | Sievers, Wilm, Dineen, et al. | Mol. Syst. Biol. | 2011 | Full Article | 6pp (7:539) | ~20,000+ |

### 2.2 Pattern Analysis of Similar Publications

**Title format for Application Notes:**
- Pattern: `[ToolName]: [short descriptor]` or `[ToolName] Version X—[what it does]`
- Examples: "AliView: a fast and lightweight alignment viewer and editor for large datasets"
- Colons are near-universal; version numbers optional but helpful

**Abstract style for Application Notes:**
- **Summary**: 1 paragraph, 100-200 words
- Structure: (1) What the tool is, (2) Key novel features, (3) Availability statement
- NO "Background/Methods/Results/Conclusions" sections
- Ends with "Availability and Implementation" or similar line

**Figure types in Application Notes:**
- Typically **1-2 figures total**
- Figure 1: Screenshot of the tool showing key features (almost universal)
- Figure 2 (optional): Example output, workflow diagram, or comparison
- Screenshots must be publication-quality, well-annotated

**Supplementary materials:**
- Application Notes: User manual, example data, installation instructions
- Full Papers: Benchmark datasets, detailed methods, additional validation

### 2.3 What Makes a Successful Application Note

From analysis of highly-cited Application Notes (Jalview: 3,000+, UGENE: 3,900+):

1. **Clear novelty statement** — What gap does this fill that existing tools don't?
2. **Crisp feature description** — List 3-5 key features, not everything
3. **One compelling screenshot** — Shows the tool in action with real data
4. **Immediate availability** — Free download/access, working URL
5. **Use case demonstration** — Show the tool being useful for a real biological problem
6. **Concise writing** — Every word earns its place in 2,000 words

---

## 3. DECISION: RECOMMENDED MANUSCRIPT TYPE

### 3.1 MSA Viewer Feature Assessment

Given the described feature set:
- 15+ feature categories
- 4 view modes
- SAM/BAM support
- Codon analysis
- Dot plot visualization
- Repeat finder
- Tree builder
- RTF/SVG export
- Web server with MAFFT/BLAST/SSH integration
- Snapshot system
- GeneDoc-style editing

**Scale assessment:** This is a **feature-rich, multi-modal tool**. It exceeds the typical scope of a Bioinformatics Application Note (which usually describes a single-purpose tool or focused functionality). However, it's primarily an integration/visualization platform rather than introducing novel algorithms — which fits Application Note scope better than Original Paper.

### 3.2 Recommendation by Journal

#### **🥇 PRIMARY RECOMMENDATION: Bioinformatics (Oxford) — Application Note**

**Reasoning:**
- All comparable MSA viewers (Jalview, AliView, UGENE, MSAViewer) published as Application Notes here
- The 4-page limit (~2,600 words) is tight but achievable by focusing on the top 5-6 most innovative features
- The journal has the exact right audience (bioinformaticians who would use the tool)
- Impact Factor ~6.0 provides strong visibility
- Application Notes have a faster review cycle than Original Papers
- No APC concerns if institution has OUP read-and-publish agreement

**Challenge:** Fitting 15+ features into 4 pages. Strategy: emphasize the 5-6 most novel/differentiating features in the main text; list remaining features in a table or supplementary file.

#### **🥈 SECONDARY OPTION: NAR Web Server Issue** (only if server is primary)

**When to choose this:**
- If the web server (MAFFT/BLAST/SSH) is the PRIMARY contribution
- ONLY if you can meet the December 20 pre-submission deadline
- The server must be publicly accessible, stable, and demonstrably useful

**Pros:** Highest prestige (IF ~16), broadest readership
**Cons:** Annual cycle, competitive, server-must-be-primary constraint, need user statistics

#### **🥉 TERTIARY OPTION: BMC Bioinformatics — Software Article**

**When to choose this:**
- If you need unlimited space to describe all 15+ features
- If you want to include extensive benchmarks
- If Bioinformatics Application Note is rejected for being too feature-rich

**Pros:** No page limit, full article format allows thorough description
**Cons:** Lower IF (~3.0), APC cost (~$2,990), longer review

### 3.3 Manuscript Type Decision Matrix

| Criterion | Bioinf. App Note | NAR Web Server | BMC Software |
|-----------|:---:|:---:|:---:|
| Precedent for MSA viewers | ★★★★★ | ★★ | ★★★ |
| Prestige / Impact Factor | ★★★★ | ★★★★★ | ★★★ |
| Space for 15+ features | ★★ | ★★ | ★★★★★ |
| Review speed | ★★★★ | ★★★ | ★★★ |
| Acceptance probability | ★★★★ | ★★★ | ★★★★ |
| Cost | Free* | Free* | ~$2,990 |
| Deadline flexibility | Year-round | Dec 20 annual | Year-round |

*\*Assuming institutional OUP read-and-publish agreement*

### 3.4 Final Recommendation

**Submit as a Bioinformatics Application Note**, structured as follows:
- Title: "MSA Viewer: an integrated platform for multiple sequence alignment visualization, editing, and analysis"
- Focus the main text on: (1) unified MSA workflow, (2) server integration (MAFFT/BLAST), (3) unique views (dot plot, codon), (4) snapshot/export system, (5) tree builder
- Use one comprehensive screenshot as Figure 1
- List all 15+ features in a Supplementary Table
- Word count target: ~2,000 words + 1-2 figures

**If rejected or if more space is genuinely needed**, resubmit to BMC Bioinformatics as a Software Article (unlimited pages).

---

## 4. WHAT WE NEED TO PREPARE

### 4.1 Essential Preparation Checklist

#### Figures (for Application Note: 1-2 figures)
1. **Figure 1 (REQUIRED):** High-resolution screenshot of MSA Viewer showing:
   - An alignment with color-coded residues
   - Multiple view modes visible (or inset panels)
   - Key UI elements labeled
   - Use real biological data (e.g., a protein family alignment)
   
2. **Figure 2 (OPTIONAL):** Either:
   - Server mode workflow diagram (input → MAFFT/BLAST → visualization)
   - Output example (RTF/SVG export, dot plot, or tree visualization)
   - Comparison table (feature matrix vs Jalview, AliView, UGENE)

#### Evidence of Utility (Choose 2-3)
- [ ] **Benchmark**: Time/memory performance on alignments of increasing size (100, 1K, 10K, 100K sequences) vs Jalview and AliView
- [ ] **Use case #1**: Biomedical example — e.g., "Analyzing SARS-CoV-2 spike protein variants across 500+ sequences"
- [ ] **Use case #2**: Phylogenetic workflow — "From MSA to tree: a complete workflow in MSA Viewer"
- [ ] **User metrics**: Download counts, unique users, server hits (if available)
- [ ] **Comparison table**: Feature presence/absence across MSA Viewer, Jalview, AliView, UGENE

#### Supplementary Materials
- [ ] `Supplementary_Table_S1.xlsx` — Complete feature list (all 15+ categories)
- [ ] `Supplementary_File_S1.pdf` — User manual or quick-start guide
- [ ] `Supplementary_Data_S1` — Example alignment files (FASTA format, real data)
- [ ] `Supplementary_Methods` — Installation instructions, dependencies, system requirements

#### Manuscript Components
- [ ] **Abstract**: 150-200 words — what, why novel, availability
- [ ] **Introduction**: 1 paragraph — the MSA visualization landscape, gaps in existing tools
- [ ] **Features**: 3-4 paragraphs covering top 5-6 features
- [ ] **Implementation**: 1 paragraph — language, architecture, dependencies
- [ ] **Use Case**: 1 paragraph — one compelling example
- [ ] **Conclusion**: 2-3 sentences
- [ ] **Availability**: GitHub URL, license, documentation link, server URL (if applicable)
- [ ] **Acknowledgments** + **Funding**

#### Pre-Submission Checklist
- [ ] Software deposited on GitHub (public repository)
- [ ] README with clear installation instructions
- [ ] Open-source license (GPL-3.0 or MIT recommended)
- [ ] Documentation / wiki available
- [ ] Web server (if mentioned) live and accessible
- [ ] All authors registered on OUP ScholarOne
- [ ] Manuscript formatted with OUP Bioinformatics template
- [ ] Figures at 300+ DPI resolution
- [ ] All URLs tested and working

### 4.2 Timeline Estimate

| Task | Time |
|------|------|
| Screenshot preparation | 2-3 days |
| Benchmark runs | 3-5 days |
| Manuscript drafting | 1-2 weeks |
| Internal review | 1 week |
| Formatting & submission | 2-3 days |
| **Total to submission** | **~3-4 weeks** |

### 4.3 Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Rejected for "insufficient novelty" | Emphasize unique combination of features, not individual ones |
| Rejected for "too many features for App Note" | Focus on 5-6 in text; table everything else in supplementary |
| NAR deadline missed | Bioinformatics accepts year-round |
| Reviewer requests benchmarks | Have a basic performance comparison ready |
| Server instability | Have fallback download option; don't make server the only access method |

---

## 5. COMPARATIVE TABLE: JOURNAL GUIDELINES AT A GLANCE

| | Bioinformatics App Note | NAR Web Server | BMC Software Article |
|---|:---:|:---:|:---:|
| Word limit | ~2,000-2,600 | ~2,000-4,000 | No limit |
| Pages | 4 | 2-4 | Unlimited |
| Figures | 1-2 | 2-3 | Unlimited |
| Abstract | Short (~150w) | Short | Structured (~350w) |
| Pre-approval | No | Yes (Dec 20) | No |
| Submission | Year-round | Annual cycle | Year-round |
| IF (2024) | ~6.0 | ~16.0 | ~3.0 |
| OA cost | Varies | Varies | ~$2,990 |
| Software focus | Tools, DBs, servers | Web servers ONLY | Open-source software |
| Benchmarks needed | Minimal | Minimal | Recommended |
| User stats needed | No | Helpful | No |

---

**Bottom line: Bioinformatics Application Note is the best fit by precedent, audience, and scope. Start drafting now. If rejected or scope demands more space, pivot to BMC Bioinformatics Software Article.**
