#!/usr/bin/env python3
"""
analyze_relion_classes.py
--------------------------
Comprehensive per-class analysis of a RELION 3D classification STAR file.
Produces publication-quality plots and a markdown summary of key findings.

Plots generated
---------------
1. LCC per class          — violin + jitter  (PyTom template-matching score)
2. CTF resolution         — violin            (tomogram quality proxy)
3. Z-position             — histogram overlay (detect surface/carbon artefacts)
4. XY spatial heatmap     — 2D density per class (detect clustering)
5. Tilt angle             — histogram overlay (detect missing-wedge bias)
6. LogLikeli vs LCC       — scatter, coloured by class
7. MaxValueProb           — violin            (classification certainty)
8. Summary panel          — bar charts N + mean LCC + mean CTF per class

Usage
-----
    python analyze_relion_classes.py --input relion_class_with_lcc.star
    python analyze_relion_classes.py --input run_it025.star --known-good 2
    python analyze_relion_classes.py --input run_it025.star --output-dir ./results
"""

import argparse
import os
import sys
import re
import math
import statistics
from collections import defaultdict

# ── colour palette ────────────────────────────────────────────────────────────
# Designed for max contrast + visible when overlapping (perceptually uniform)
CLASS_COLOURS = [
    "#2196F3",   # blue
    "#FF5722",   # deep-orange
    "#4CAF50",   # green
    "#9C27B0",   # purple
    "#FF9800",   # amber
    "#00BCD4",   # cyan
    "#F44336",   # red
    "#8BC34A",   # light-green
    "#E91E63",   # pink
    "#009688",   # teal
]

def colour(i):
    return CLASS_COLOURS[i % len(CLASS_COLOURS)]

# ── STAR parser ───────────────────────────────────────────────────────────────

def parse_star(path):
    blocks = []
    cur = None
    in_loop = False
    cols = []
    skip = re.compile(r'^\s*(#.*)?$')
    with open(path) as fh:
        for raw in fh:
            s = raw.strip()
            if skip.match(s):
                continue
            if s.startswith('data_'):
                if cur: blocks.append(cur)
                cur = {'name': s, 'is_loop': False, 'columns': [], 'rows': []}
                in_loop = False; cols = []
                continue
            if cur is None:
                continue
            if s.startswith('loop_'):
                in_loop = True; cur['is_loop'] = True; cols = []
                continue
            if in_loop:
                if s.startswith('_'):
                    cols.append(s.split()[0]); cur['columns'] = cols
                else:
                    cur['rows'].append(s.split())
            else:
                p = s.split(None, 1)
                if len(p) == 2 and p[0].startswith('_'):
                    cur['rows'].append(p); cur['columns'].append(p[0])
    if cur: blocks.append(cur)
    return blocks


def find_particles(blocks):
    for b in blocks:
        if b['is_loop'] and '_rlnClassNumber' in b['columns']:
            return b
    return None


def col_vals(rows, cols, name, cast=float, default=None):
    if name not in cols:
        return [default] * len(rows)
    i = cols.index(name)
    out = []
    for r in rows:
        try:
            out.append(cast(r[i]) if i < len(r) else default)
        except (ValueError, TypeError):
            out.append(default)
    return out


# ── Analysis helpers ──────────────────────────────────────────────────────────

def group_by_class(class_col, *value_cols):
    """Returns dict {class_id: [list per value_col]}."""
    result = defaultdict(lambda: [[] for _ in value_cols])
    for i, cls in enumerate(class_col):
        if cls is None: continue
        try:
            c = int(cls)
        except (TypeError, ValueError):
            continue
        for j, vc in enumerate(value_cols):
            if vc[i] is not None:
                try:
                    result[c][j].append(float(vc[i]))
                except (TypeError, ValueError):
                    pass
    return result


def compute_insights(class_col, data, known_good=None, px=11.056,
                     tomo_half_z=156.0):
    """Return list of insight strings."""
    insights = []
    classes = sorted(set(int(c) for c in class_col if c is not None))
    n_total = len(class_col)

    lcc = data.get('lcc', {})
    ctf = data.get('ctf', {})
    tilt = data.get('tilt', {})
    mvp = data.get('mvp', {})
    loglik = data.get('loglik', {})
    z_ang = data.get('z_ang', {})

    # ── K sufficiency ────────────────────────────────────────────────────────
    k_suggested = max(2, round(math.sqrt(n_total / 200)))
    k_used = len(classes)
    if k_used < k_suggested:
        insights.append(
            f"⚠ **More classes recommended**: used K={k_used}, "
            f"Crowther rule suggests K=√(N/200)=**{k_suggested}** for "
            f"N={n_total} particles. More classes may reveal sub-populations."
        )
    else:
        insights.append(
            f"✓ K={k_used} classes for N={n_total} particles — "
            f"consistent with recommended K≈{k_suggested}."
        )

    # ── Class size balance ───────────────────────────────────────────────────
    sizes = {c: sum(1 for x in class_col if x is not None and int(x) == c)
             for c in classes}
    dominant = max(sizes, key=sizes.get)
    dom_pct = sizes[dominant] / n_total * 100
    if dom_pct > 60:
        insights.append(
            f"⚠ **Class {dominant} dominates** ({dom_pct:.0f}% of particles). "
            f"This likely contains heterogeneous junk or unaligned particles. "
            f"Consider excluding it and re-running classification on the remainder."
        )

    # ── LCC insights ────────────────────────────────────────────────────────
    if lcc:
        lcc_meds = {c: statistics.median(v) for c, v in lcc.items() if v}
        best_lcc_cls = max(lcc_meds, key=lcc_meds.get)
        worst_lcc_cls = min(lcc_meds, key=lcc_meds.get)
        spread = lcc_meds[best_lcc_cls] - lcc_meds[worst_lcc_cls]
        insights.append(
            f"**LCC spread across classes: Δ={spread:.4f}** "
            f"(Class {best_lcc_cls} highest={lcc_meds[best_lcc_cls]:.4f}, "
            f"Class {worst_lcc_cls} lowest={lcc_meds[worst_lcc_cls]:.4f}). "
            f"A larger spread means LCC is more discriminative for class separation."
        )
        if spread < 0.01:
            insights.append(
                "⚠ **LCC alone cannot separate classes** — all classes have "
                "similar template-matching scores. Classification is driven by "
                "structural features, not detection quality. This is normal for "
                "good datasets where TM picked mostly real particles."
            )

        if known_good:
            good_lcc = statistics.median(lcc.get(known_good, [0]))
            insights.append(
                f"ℹ Class {known_good} (confirmed real particles): "
                f"median LCC = **{good_lcc:.4f}**. "
                f"Use this as reference for future TM cutoff selection."
            )

    # ── CTF insights ────────────────────────────────────────────────────────
    if ctf:
        ctf_meds = {c: statistics.median(v) for c, v in ctf.items() if v}
        best_ctf_cls = min(ctf_meds, key=ctf_meds.get)   # lower = better
        worst_ctf_cls = max(ctf_meds, key=ctf_meds.get)
        ctf_spread = ctf_meds[worst_ctf_cls] - ctf_meds[best_ctf_cls]
        if ctf_spread > 0.5:
            insights.append(
                f"⚠ **CTF quality differs between classes** (spread={ctf_spread:.2f} Å): "
                f"Class {best_ctf_cls} particles come from better tomograms "
                f"(median CTF={ctf_meds[best_ctf_cls]:.2f} Å) vs "
                f"Class {worst_ctf_cls} (median CTF={ctf_meds[worst_ctf_cls]:.2f} Å). "
                f"Poor-CTF classes may be enriched in junk from low-SNR tomograms."
            )
        else:
            insights.append(
                f"✓ CTF resolution is similar across classes (spread={ctf_spread:.2f} Å) — "
                f"tomogram quality is not the main driver of class separation."
            )

    # ── Missing wedge / tilt bias ────────────────────────────────────────────
    if tilt:
        for c, tilts in tilt.items():
            if not tilts: continue
            near_beam = sum(1 for t in tilts if t < 20 or t > 160) / len(tilts) * 100
            near_90 = sum(1 for t in tilts if 70 < t < 110) / len(tilts) * 100
            if near_beam > 15:
                insights.append(
                    f"⚠ **Class {c}: {near_beam:.0f}% of particles have tilt angle < 20° "
                    f"or > 160°** (near beam direction). This indicates missing-wedge "
                    f"artefacts — these particles are likely false picks aligned along "
                    f"the beam axis where contrast is artificially high."
                )
            if near_90 > 75 and c != known_good:
                insights.append(
                    f"ℹ Class {c}: {near_90:.0f}% of particles cluster near tilt=90° — "
                    f"these are oriented perpendicular to beam, which is expected for "
                    f"real particles but also for flat structures like carbon film."
                )

    # ── Z-position ───────────────────────────────────────────────────────────
    if z_ang:
        for c, zvals in z_ang.items():
            if not zvals: continue
            abs_z = [abs(v) for v in zvals]
            surface_fraction = sum(1 for v in abs_z
                                   if v > tomo_half_z * px * 0.7) / len(abs_z) * 100
            if surface_fraction > 30:
                insights.append(
                    f"⚠ **Class {c}: {surface_fraction:.0f}% of particles near tomogram "
                    f"surface** (|Z| > 70% of half-thickness). Surface particles are "
                    f"often carbon contamination or gold fiducials."
                )

    # ── Separation quality ───────────────────────────────────────────────────
    if mvp:
        overall_mvp = [v for vals in mvp.values() for v in vals]
        if overall_mvp:
            uncertain = sum(1 for v in overall_mvp if v < 0.7) / len(overall_mvp) * 100
            if uncertain > 10:
                insights.append(
                    f"⚠ **{uncertain:.0f}% of particles have MVP < 0.7** — "
                    f"RELION is uncertain about their class assignment. "
                    f"Consider increasing iterations or using --sigma_ang."
                )
            else:
                insights.append(
                    f"✓ Classification is well-converged: < {uncertain:.0f}% uncertain "
                    f"particles (MVP < 0.7)."
                )

    return insights


# ── Plotting ──────────────────────────────────────────────────────────────────

def setup_ax(ax, title, xlabel=None, ylabel=None):
    ax.set_title(title, fontsize=10, fontweight='bold', pad=6)
    if xlabel: ax.set_xlabel(xlabel, fontsize=9)
    if ylabel: ax.set_ylabel(ylabel, fontsize=9)
    ax.tick_params(labelsize=8)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(axis='y', linestyle='--', alpha=0.35, zorder=0)


def jitter_scatter(ax, pos, vals, col, rng):
    xs = [pos + rng.uniform(-0.16, 0.16) for _ in vals]
    ax.scatter(xs, vals, color=col, alpha=0.25, s=5, zorder=3, linewidths=0)


def violin_plot(ax, cls_data, title, ylabel, unit='', known_good=None):
    import numpy as np
    classes = sorted(cls_data.keys())
    cols = [colour(i) for i in range(len(classes))]
    positions = list(range(1, len(classes) + 1))
    data_lists = [cls_data[c] for c in classes]

    parts = ax.violinplot(data_lists, positions=positions,
                          showmedians=True, showextrema=True, widths=0.65)
    for i, pc in enumerate(parts['bodies']):
        pc.set_facecolor(cols[i])
        pc.set_alpha(0.50)
        if known_good is not None and classes[i] == known_good:
            pc.set_edgecolor('#FFD700')
            pc.set_linewidth(2)
    for k in ('cmedians', 'cbars', 'cmins', 'cmaxes'):
        parts[k].set_color('black')
        parts[k].set_linewidth(1.1)

    import random
    rng = random.Random(42)
    for i, (pos, vals) in enumerate(zip(positions, data_lists)):
        jitter_scatter(ax, pos, vals, cols[i], rng)

    labels = [f'Class {c}' + (' ★' if c == known_good else '') for c in classes]
    ax.set_xticks(positions)
    ax.set_xticklabels(labels, fontsize=8)
    setup_ax(ax, title, ylabel=ylabel + (f' ({unit})' if unit else ''))

    # n-count labels
    ymin, ymax = ax.get_ylim()
    margin = (ymax - ymin) * 0.04
    ax.set_ylim(ymin, ymax + margin * 4)
    for pos, vals in zip(positions, data_lists):
        ax.text(pos, ymax + margin * 0.3, f'n={len(vals)}',
                ha='center', va='bottom', fontsize=7, color='#444')


def hist_overlay(ax, cls_data, title, xlabel, unit='', bins=30,
                 density=True, known_good=None, vline=None):
    classes = sorted(cls_data.keys())
    for i, c in enumerate(classes):
        vals = cls_data[c]
        if not vals: continue
        label = f'Class {c}' + (' ★' if c == known_good else '') + f' (n={len(vals)})'
        lw = 2.0 if c == known_good else 0.8
        ax.hist(vals, bins=bins, alpha=0.40, color=colour(i),
                label=label, density=density, edgecolor=colour(i),
                linewidth=lw, histtype='stepfilled')
        # overlay step outline for visibility when classes overlap
        ax.hist(vals, bins=bins, density=density,
                histtype='step', color=colour(i), linewidth=lw)
    if vline is not None:
        ax.axvline(vline, color='black', linestyle='--', linewidth=1,
                   label=f'cutoff = {vline:.3f}')
    ax.set_xlabel(xlabel + (f' ({unit})' if unit else ''), fontsize=9)
    ax.set_ylabel('Density', fontsize=9)
    ax.legend(fontsize=7, framealpha=0.7)
    setup_ax(ax, title)


def scatter_2d(ax, x_vals, y_vals, class_col, classes, title,
               xlabel, ylabel, known_good=None, alpha=0.25, s=6):
    cls_list = sorted(set(classes))
    for i, c in enumerate(cls_list):
        mask = [j for j, v in enumerate(class_col) if v == c]
        xs = [x_vals[j] for j in mask]
        ys = [y_vals[j] for j in mask]
        label = f'Class {c}' + (' ★' if c == known_good else '')
        lw = 1.5 if c == known_good else 0
        ax.scatter(xs, ys, c=colour(i), alpha=alpha, s=s,
                   label=label, linewidths=lw,
                   edgecolors='#FFD700' if c == known_good else 'none',
                   zorder=3 if c == known_good else 2)
    ax.legend(fontsize=7, framealpha=0.7, markerscale=2)
    setup_ax(ax, title, xlabel=xlabel, ylabel=ylabel)


def summary_bars(ax1, ax2, ax3, cls_sizes, lcc_data, ctf_data,
                 n_total, known_good=None):
    import numpy as np
    classes = sorted(cls_sizes.keys())
    cols = [colour(i) for i in range(len(classes))]
    x = np.arange(len(classes))
    w = 0.6

    # N bar
    ns = [cls_sizes[c] for c in classes]
    bars = ax1.bar(x, [100 * n / n_total for n in ns], width=w,
                   color=cols, alpha=0.75, edgecolor='black', linewidth=0.5)
    for bar, cls in zip(bars, classes):
        if cls == known_good:
            bar.set_edgecolor('#FFD700')
            bar.set_linewidth(2.5)
    ax1.set_xticks(x)
    ax1.set_xticklabels([f'C{c}' for c in classes], fontsize=8)
    setup_ax(ax1, 'Particle count (%)', ylabel='%')

    # LCC bar
    if lcc_data:
        lcc_means = [statistics.mean(lcc_data.get(c, [0])) if lcc_data.get(c) else 0
                     for c in classes]
        lcc_stds = [statistics.stdev(lcc_data.get(c, [0]))
                    if lcc_data.get(c) and len(lcc_data[c]) > 1 else 0
                    for c in classes]
        bars2 = ax2.bar(x, lcc_means, width=w, color=cols, alpha=0.75,
                        edgecolor='black', linewidth=0.5, yerr=lcc_stds,
                        error_kw=dict(ecolor='black', capsize=3, linewidth=0.8))
        for bar, cls in zip(bars2, classes):
            if cls == known_good:
                bar.set_edgecolor('#FFD700'); bar.set_linewidth(2.5)
        ax2.set_xticks(x)
        ax2.set_xticklabels([f'C{c}' for c in classes], fontsize=8)
        setup_ax(ax2, 'Mean LCC ± std', ylabel='LCC')

    # CTF bar
    if ctf_data:
        ctf_means = [statistics.mean(ctf_data.get(c, [0])) if ctf_data.get(c) else 0
                     for c in classes]
        bars3 = ax3.bar(x, ctf_means, width=w, color=cols, alpha=0.75,
                        edgecolor='black', linewidth=0.5)
        for bar, cls in zip(bars3, classes):
            if cls == known_good:
                bar.set_edgecolor('#FFD700'); bar.set_linewidth(2.5)
        ax3.set_xticks(x)
        ax3.set_xticklabels([f'C{c}' for c in classes], fontsize=8)
        setup_ax(ax3, 'Mean CTF resolution', ylabel='Å (lower = better)')
        ax3.invert_yaxis()


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description='Comprehensive RELION class analysis with LCC scores.')
    ap.add_argument('--input', '-i', required=True,
                    help='STAR file (after transfer_lcc_values.py)')
    ap.add_argument('--output', '-o', default=None,
                    help='Output PDF/PNG. Default: <stem>_class_analysis.pdf')
    ap.add_argument('--output-dir', default=None,
                    help='Output directory (default: same as input)')
    ap.add_argument('--known-good', type=int, default=None,
                    help='Class number known to contain real particles (starred in plots)')
    ap.add_argument('--pixel-size', type=float, default=11.056,
                    help='Pixel size in Å (default: 11.056)')
    ap.add_argument('--tomo-half-z', type=float, default=156.0,
                    help='Tomo half-depth in pixels (default: 156)')
    ap.add_argument('--lcc-cutoff', type=float, default=None,
                    help='Show a vertical LCC cutoff line on the LCC histogram')
    ap.add_argument('--no-markdown', action='store_true',
                    help='Skip markdown insights file')
    args = ap.parse_args()

    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import matplotlib.gridspec as gridspec
        import numpy as np
    except ImportError:
        sys.exit('ERROR: pip install matplotlib numpy')

    # ── Parse ────────────────────────────────────────────────────────────────
    print(f'Reading {args.input} ...')
    blocks = parse_star(args.input)
    part = find_particles(blocks)
    if part is None:
        sys.exit('ERROR: No particles block with _rlnClassNumber found.')

    tc = part['columns']
    rows = part['rows']
    n = len(rows)
    print(f'  {n} particles')

    px = args.pixel_size
    half_z = args.tomo_half_z

    # Extract columns
    cls_col = col_vals(rows, tc, '_rlnClassNumber', cast=int)
    lcc_col = col_vals(rows, tc, '_rlnLCCmax', cast=lambda x: None if x == 'nan' else float(x))
    ctf_col = col_vals(rows, tc, '_rlnCtfMaxResolution')
    tilt_col = col_vals(rows, tc, '_rlnAngleTilt')
    rot_col = col_vals(rows, tc, '_rlnAngleRot')
    psi_col = col_vals(rows, tc, '_rlnAnglePsi')
    x_col = col_vals(rows, tc, '_rlnCoordinateX')
    y_col = col_vals(rows, tc, '_rlnCoordinateY')
    z_col = col_vals(rows, tc, '_rlnCoordinateZ')
    ll_col = col_vals(rows, tc, '_rlnLogLikeliContribution')
    mvp_col = col_vals(rows, tc, '_rlnMaxValueProbDistribution')

    z_ang_col = [(z - half_z) * px if z is not None else None for z in z_col]

    classes = sorted(set(c for c in cls_col if c is not None))
    print(f'  {len(classes)} classes: {classes}')

    # Group by class
    g = group_by_class(cls_col, lcc_col, ctf_col, tilt_col, z_ang_col,
                       x_col, y_col, ll_col, mvp_col)
    lcc_by_cls  = {c: [v for v in g[c][0] if v is not None] for c in classes}
    ctf_by_cls  = {c: [v for v in g[c][1] if v is not None] for c in classes}
    tilt_by_cls = {c: [v for v in g[c][2] if v is not None] for c in classes}
    z_by_cls    = {c: [v for v in g[c][3] if v is not None] for c in classes}
    x_by_cls    = {c: [v for v in g[c][4] if v is not None] for c in classes}
    y_by_cls    = {c: [v for v in g[c][5] if v is not None] for c in classes}
    ll_by_cls   = {c: [v for v in g[c][6] if v is not None] for c in classes}
    mvp_by_cls  = {c: [v for v in g[c][7] if v is not None] for c in classes}
    cls_sizes   = {c: sum(1 for x in cls_col if x == c) for c in classes}

    has_lcc = any(lcc_by_cls.values())
    has_ctf = any(ctf_by_cls.values())
    has_tilt = any(tilt_by_cls.values())

    # ── Insights ─────────────────────────────────────────────────────────────
    data_for_insights = dict(
        lcc=lcc_by_cls, ctf=ctf_by_cls, tilt=tilt_by_cls,
        z_ang=z_by_cls, mvp=mvp_by_cls, loglik=ll_by_cls
    )
    insights = compute_insights(
        cls_col, data_for_insights,
        known_good=args.known_good,
        px=px, tomo_half_z=half_z
    )
    print('\nKey insights:')
    for ins in insights:
        # strip markdown for terminal
        print(' ', re.sub(r'\*+', '', ins))

    # ── Figure layout ─────────────────────────────────────────────────────────
    fig = plt.figure(figsize=(18, 22))
    gs = gridspec.GridSpec(4, 3, figure=fig, hspace=0.55, wspace=0.38)

    ax_lcc  = fig.add_subplot(gs[0, 0])
    ax_ctf  = fig.add_subplot(gs[0, 1])
    ax_mvp  = fig.add_subplot(gs[0, 2])
    ax_z    = fig.add_subplot(gs[1, 0])
    ax_tilt = fig.add_subplot(gs[1, 1])
    ax_xy   = fig.add_subplot(gs[1, 2])
    ax_scat = fig.add_subplot(gs[2, :2])
    ax_n    = fig.add_subplot(gs[2, 2])
    ax_b1   = fig.add_subplot(gs[3, 0])
    ax_b2   = fig.add_subplot(gs[3, 1])

    kg = args.known_good

    # 1. LCC violin
    if has_lcc:
        violin_plot(ax_lcc, lcc_by_cls,
                    'PyTom LCC score per class\n'
                    '(higher = better match with template during TM)',
                    'LCCmax', known_good=kg)
    else:
        ax_lcc.text(0.5, 0.5, 'LCC values not available\n(run transfer_lcc_values.py first)',
                    ha='center', va='center', transform=ax_lcc.transAxes, fontsize=9)
        ax_lcc.set_title('LCC — not available', fontsize=10)

    # 2. CTF resolution violin
    if has_ctf:
        violin_plot(ax_ctf, ctf_by_cls,
                    'CTF resolution per class\n'
                    '(lower = better tomogram quality)',
                    'Å', known_good=kg)
        ax_ctf.invert_yaxis()
    else:
        ax_ctf.text(0.5, 0.5, 'CTF data not available',
                    ha='center', va='center', transform=ax_ctf.transAxes)

    # 3. MVP violin
    if any(mvp_by_cls.values()):
        violin_plot(ax_mvp, mvp_by_cls,
                    'Max value probability per class\n'
                    '(1.0 = RELION certain; < 0.7 = ambiguous assignment)',
                    'MVP', known_good=kg)
    else:
        ax_mvp.set_visible(False)

    # 4. Z-position histogram
    if z_by_cls:
        hist_overlay(ax_z, z_by_cls,
                     'Z-position per class\n'
                     '(centred on tomo midplane — surface artefacts peak at extremes)',
                     'Z from midplane', 'Å', bins=30, known_good=kg)
        ax_z.axvline(0, color='gray', linestyle=':', linewidth=1, alpha=0.7,
                     label='midplane')

    # 5. Tilt angle histogram
    if has_tilt:
        hist_overlay(ax_tilt, tilt_by_cls,
                     'Tilt angle distribution per class\n'
                     '(< 20° or > 160° = near beam axis → missing-wedge artefact)',
                     'Tilt angle', '°', bins=36, known_good=kg)
        ax_tilt.axvspan(0, 20, alpha=0.08, color='red', label='beam zone')
        ax_tilt.axvspan(160, 180, alpha=0.08, color='red')

    # 6. XY spatial — class fraction heatmap (2D histogram overlay)
    all_x = [v for vals in x_by_cls.values() for v in vals]
    all_y = [v for vals in y_by_cls.values() for v in vals]
    if all_x and all_y:
        x_flat = [x for c in classes for x in x_by_cls[c]]
        y_flat = [y for c in classes for y in y_by_cls[c]]
        c_flat = [c for c in classes for _ in x_by_cls[c]]
        scatter_2d(ax_xy, x_flat, y_flat, c_flat, classes,
                   'XY spatial distribution per class\n'
                   '(spatial clustering may indicate artefacts or real structure)',
                   'X (px)', 'Y (px)', known_good=kg, alpha=0.20, s=4)

    # 7. LogLikeli vs LCC scatter
    if has_lcc and any(ll_by_cls.values()):
        ll_flat  = [v for c in classes for v in ll_by_cls[c]]
        lcc_flat = [v for c in classes for v in lcc_by_cls[c]]
        c_flat2  = [c for c in classes for _ in ll_by_cls[c]]
        # need to align lengths
        ll_f2=[]; lcc_f2=[]; c_f2=[]
        for c in classes:
            vals_ll  = ll_by_cls[c]
            vals_lcc = lcc_by_cls[c]
            ml = min(len(vals_ll), len(vals_lcc))
            ll_f2.extend(vals_ll[:ml]); lcc_f2.extend(vals_lcc[:ml])
            c_f2.extend([c] * ml)
        scatter_2d(ax_scat, lcc_f2, ll_f2, c_f2, classes,
                   'LogLikelihood vs LCC — are high-scoring TM particles also well-classified?\n'
                   '(real particles cluster top-right; junk is scattered)',
                   'LCCmax', 'LogLikelihood', known_good=kg, alpha=0.25, s=6)
        if args.lcc_cutoff:
            ax_scat.axvline(args.lcc_cutoff, color='black', linestyle='--',
                            linewidth=1, label=f'LCC cutoff={args.lcc_cutoff:.3f}')

    # 8. Summary N bar
    summary_bars(ax_n, ax_b1, ax_b2,
                 cls_sizes,
                 lcc_by_cls if has_lcc else {},
                 ctf_by_cls if has_ctf else {},
                 n, known_good=kg)

    # ── Insight legend ────────────────────────────────────────────────────────
    if kg is not None:
        fig.text(0.01, 0.005,
                 f'★ = Class {kg} (confirmed real particles)',
                 fontsize=8, color='#888', style='italic')

    # ── Title ─────────────────────────────────────────────────────────────────
    fname = os.path.basename(args.input)
    fig.suptitle(
        f'RELION 3D Classification — comprehensive class analysis\n'
        f'{fname}  |  N={n}  |  K={len(classes)} classes',
        fontsize=12, fontweight='bold', y=1.002
    )

    # ── Save plot ─────────────────────────────────────────────────────────────
    stem = os.path.splitext(args.input)[0]
    if args.output_dir:
        os.makedirs(args.output_dir, exist_ok=True)
        stem = os.path.join(args.output_dir, os.path.basename(stem))
    outfile = args.output or f'{stem}_class_analysis.pdf'
    plt.savefig(outfile, bbox_inches='tight', dpi=160)
    print(f'\nPlot saved → {outfile}')

    # ── Markdown insights ─────────────────────────────────────────────────────
    if not args.no_markdown:
        md_file = outfile.replace('.pdf', '.md').replace('.png', '.md')
        with open(md_file, 'w') as fh:
            fh.write(f'# RELION Classification Analysis\n\n')
            fh.write(f'**File:** `{fname}`  \n')
            fh.write(f'**Particles:** {n}  |  **Classes:** {len(classes)}  \n')
            if kg: fh.write(f'**Confirmed real class:** {kg}  \n')
            fh.write(f'\n## Key Findings\n\n')
            for ins in insights:
                fh.write(f'- {ins}\n')
            fh.write(f'\n## Class Statistics\n\n')
            fh.write(f'| Class | N | % | LCC median | CTF median (Å) | MVP median |\n')
            fh.write(f'|-------|---|---|-----------|---------------|----------|\n')
            for c in classes:
                nn = cls_sizes[c]
                pct = nn / n * 100
                lcc_m = f'{statistics.median(lcc_by_cls[c]):.4f}' if lcc_by_cls.get(c) else '—'
                ctf_m = f'{statistics.median(ctf_by_cls[c]):.2f}' if ctf_by_cls.get(c) else '—'
                mvp_m = f'{statistics.median(mvp_by_cls[c]):.4f}' if mvp_by_cls.get(c) else '—'
                star = ' ★' if c == kg else ''
                fh.write(f'| Class {c}{star} | {nn} | {pct:.1f}% | {lcc_m} | {ctf_m} | {mvp_m} |\n')
            fh.write(f'\n## Plot Descriptions\n\n')
            fh.write(
                '1. **LCC per class** — PyTom template-matching cross-correlation score. '
                'Higher = particle matched the template better during TM. '
                'A large spread between classes means LCC is useful for filtering.\n\n'
                '2. **CTF resolution per class** — estimated CTF fit quality of the parent tomogram. '
                'Lower = better SNR. If junk classes have worse CTF, those particles come from '
                'low-quality tomograms.\n\n'
                '3. **Max value probability** — RELION classification certainty. '
                '1.0 = unambiguously assigned. < 0.7 = RELION is unsure → more iterations needed.\n\n'
                '4. **Z-position** — particle depth relative to tomogram midplane. '
                'Surface-enriched classes (high |Z|) likely contain carbon or gold fiducials.\n\n'
                '5. **Tilt angle** — orientation relative to beam. '
                'Excess of particles near 0° or 180° indicates missing-wedge artefacts.\n\n'
                '6. **XY spatial distribution** — particle positions in XY. '
                'Spatial clustering may indicate repeated structures or artefacts.\n\n'
                '7. **LogLikelihood vs LCC** — are high-TM-score particles also well-fitted by RELION? '
                'Real particles should cluster in the upper right. Junk is scattered.\n\n'
                '8. **Summary bars** — particle fraction, mean LCC, mean CTF per class at a glance.\n'
            )
        print(f'Insights saved → {md_file}')


if __name__ == '__main__':
    main()
