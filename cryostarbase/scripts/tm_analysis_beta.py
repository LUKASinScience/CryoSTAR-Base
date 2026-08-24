#!/usr/bin/env python3
"""
CryoSTAR-Base — TM Quality Analysis
==================================
claude-sonnet-4-6 used as copilot, with manual adjustments.

Generates 8 diagnostic figures to guide decisions about:
  - Optimal score cutoff for particle extraction
  - Template matching quality and false positive rate
  - Missing wedge / geometry biases
  - Orientation coverage and angular sampling
  - Per-tomogram quality ranking
  - Nearest-neighbor crowding / duplicate detection
  - Actionable RELION processing recommendations

Required packages:
    starfile, matplotlib, numpy, scipy, pandas
    pip install starfile matplotlib numpy scipy pandas

Usage:
    python tm_analysis_beta.py <star_file> [output_prefix]
"""

import sys
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import starfile
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.colors import LinearSegmentedColormap, Normalize
from matplotlib.patches import FancyArrowPatch
import matplotlib.patheffects as pe
from collections import defaultdict
from scipy.spatial.transform import Rotation
from scipy.stats import gaussian_kde
from scipy.ndimage import gaussian_filter1d
import math


# ============================================================================
# Dark scientific theme  (inspired by scorify / Nature Methods style)
# ============================================================================
DARK_BG   = '#0d1117'
PANEL_BG  = '#161b22'
GRID_COL  = '#21262d'
TEXT_COL  = '#e6edf3'
DIM_COL   = '#8b949e'
ACCENT    = '#58a6ff'
GREEN     = '#3fb950'
YELLOW    = '#d29922'
RED       = '#f85149'
PURPLE    = '#bc8cff'
ORANGE    = '#f97316'

# Quality tier palette — colorblind-safe, ordered low→high
TIER_COLORS  = ['#d32f2f', '#f57c00', '#fbc02d', '#388e3c', '#1565c0']
TIER_LABELS  = ['< 5σ',    '5–7σ',   '7–10σ',  '10–15σ', '> 15σ']
TIER_DESCS   = [
    'Likely false positive',
    'Weak / questionable',
    'Reasonable detection',
    'Good detection',
    'High-confidence',
]
TIER_BOUNDS  = [0, 5, 7, 10, 15, np.inf]


def setup_style():
    plt.rcParams.update({
        'figure.facecolor':     DARK_BG,
        'axes.facecolor':       PANEL_BG,
        'axes.edgecolor':       GRID_COL,
        'axes.labelcolor':      TEXT_COL,
        'axes.titlecolor':      TEXT_COL,
        'axes.titlesize':       11,
        'axes.labelsize':       9,
        'axes.grid':            True,
        'grid.color':           GRID_COL,
        'grid.linewidth':       0.5,
        'grid.alpha':           0.8,
        'xtick.color':          DIM_COL,
        'ytick.color':          DIM_COL,
        'xtick.labelsize':      8,
        'ytick.labelsize':      8,
        'text.color':           TEXT_COL,
        'legend.facecolor':     PANEL_BG,
        'legend.edgecolor':     GRID_COL,
        'legend.fontsize':      8,
        'figure.titlesize':     13,
        'figure.titleweight':   'bold',
        'lines.linewidth':      1.5,
        'savefig.facecolor':    DARK_BG,
        'savefig.dpi':          180,
        'savefig.bbox':         'tight',
        'font.family':          'DejaVu Sans',
    })


def get_tier(snr):
    for i in range(len(TIER_BOUNDS) - 1):
        if TIER_BOUNDS[i] <= snr < TIER_BOUNDS[i+1]:
            return i
    return len(TIER_COLORS) - 1


def assign_tiers(snr_arr):
    tiers = np.zeros(len(snr_arr), dtype=int)
    for i in range(len(TIER_BOUNDS) - 1):
        mask = (snr_arr >= TIER_BOUNDS[i]) & (snr_arr < TIER_BOUNDS[i+1])
        tiers[mask] = i
    return tiers


def label_axes(ax, letter, x=-0.10, y=1.05):
    """Add bold panel letter like Nature Methods."""
    ax.text(x, y, letter, transform=ax.transAxes,
            fontsize=13, fontweight='bold', color=TEXT_COL, va='top', ha='right')


def add_recommendation(fig, text, y=0.01):
    fig.text(0.5, y, text, ha='center', fontsize=9, color=DIM_COL,
             bbox=dict(boxstyle='round,pad=0.5', facecolor=PANEL_BG,
                       edgecolor=GRID_COL, alpha=0.9))


# ============================================================================
# Data loading
# ============================================================================
def load_star(path):
    print(f"Reading {path} ...")
    data = starfile.read(path)
    if isinstance(data, dict):
        df = data.get('particles', list(data.values())[-1])
    else:
        df = data
    print(f"  Rows: {len(df):,}  Columns: {list(df.columns)}")
    return df


def map_columns(df):
    def find(name):
        for c in df.columns:
            if name.lower() in c.lower():
                return c
        return None
    return {
        'lcc':    find('LCCmax') or find('lcc'),
        'cutoff': find('CutOff') or find('cutoff'),
        'std':    find('SearchStd') or find('searchstd'),
        'x':      find('CoordinateX'),
        'y':      find('CoordinateY'),
        'z':      find('CoordinateZ'),
        'rot':    find('AngleRot'),
        'tilt':   find('AngleTilt'),
        'psi':    find('AnglePsi'),
        'tomo':   find('MicrographName') or find('TomoName'),
    }


def prepare_arrays(df, col):
    for k, c in col.items():
        if c and c in df.columns:
            if k not in ('tomo',):
                df[c] = pd.to_numeric(df[c], errors='coerce')
    required = ['lcc', 'std', 'x', 'y', 'z', 'tilt', 'rot', 'psi']
    mask = pd.Series(True, index=df.index)
    for k in required:
        c = col.get(k)
        if c:
            mask &= df[c].notna()
    df_v = df[mask].copy()
    print(f"  Valid: {len(df_v):,}  Skipped: {len(df)-len(df_v):,}")
    arrs = {}
    for k, c in col.items():
        if c and c in df_v.columns:
            if k == 'tomo':
                arrs[k] = df_v[c].values
            else:
                arrs[k] = df_v[c].values.astype(float)
    arrs['snr'] = np.where(arrs['std'] > 0, arrs['lcc'] / arrs['std'], 0.0)
    arrs['tier'] = assign_tiers(arrs['snr'])
    return df_v, arrs


# ============================================================================
# Figure 1 — Score Landscape & Extraction Guide
# ============================================================================
def fig_score_landscape(arrs, prefix):
    """
    The most important figure for deciding extraction cutoff.
    Shows LCC distribution, SNR distribution, cumulative extraction
    curve, and an interactive-style threshold suggestion.
    """
    lcc = arrs['lcc'];  snr = arrs['snr'];  n = len(lcc)

    fig = plt.figure(figsize=(16, 10))
    fig.suptitle('Figure 1 — Score Landscape & Extraction Threshold Guide', y=0.98)
    gs = gridspec.GridSpec(2, 3, figure=fig, hspace=0.42, wspace=0.38)

    # ── A: LCC distribution with KDE ──────────────────────────────────────
    ax = fig.add_subplot(gs[0, 0])
    label_axes(ax, 'A')
    ax.set_title('LCCmax Distribution')
    bins = np.linspace(lcc.min(), lcc.max(), 80)
    ax.hist(lcc, bins=bins, color=ACCENT, alpha=0.4, density=True, label='histogram')
    if n > 10:
        kde = gaussian_kde(lcc, bw_method=0.08)
        xs  = np.linspace(lcc.min(), lcc.max(), 500)
        ax.plot(xs, kde(xs), color=ACCENT, lw=2, label='KDE')
    ax.axvline(np.median(lcc), color=YELLOW, ls='--', lw=1.2, label=f'median {np.median(lcc):.3f}')
    ax.axvline(np.percentile(lcc, 25), color=DIM_COL, ls=':', lw=1, label='Q1')
    ax.set_xlabel('LCCmax score');  ax.set_ylabel('Density');  ax.legend()

    # ── B: SNR distribution with tier bands ────────────────────────────────
    ax = fig.add_subplot(gs[0, 1])
    label_axes(ax, 'B')
    ax.set_title('3D SNR Distribution (LCCmax / SearchStd)')
    snr_clip = np.clip(snr, 0, 30)
    for i in range(len(TIER_COLORS)):
        lo = TIER_BOUNDS[i]; hi = min(TIER_BOUNDS[i+1], 30)
        ax.axvspan(lo, hi, alpha=0.08, color=TIER_COLORS[i])
    ax.hist(snr_clip, bins=80, color=GREEN, alpha=0.6, density=True)
    if n > 10:
        kde2 = gaussian_kde(snr_clip, bw_method=0.1)
        xs2  = np.linspace(0, 30, 500)
        ax.plot(xs2, kde2(xs2), color=GREEN, lw=2)
    for i, (lo, hi, col) in enumerate(zip(TIER_BOUNDS, TIER_BOUNDS[1:], TIER_COLORS)):
        cnt = int(((snr >= lo) & (snr < hi)).sum())
        if cnt > 0:
            mid = min((lo+hi)/2, 27)
            ax.text(mid, ax.get_ylim()[1]*0.85 if ax.get_ylim()[1] > 0 else 0.01,
                    f'{cnt}', ha='center', color=col, fontsize=7, fontweight='bold')
    ax.axvline(np.median(snr), color=YELLOW, ls='--', lw=1.2, label=f'median {np.median(snr):.1f}σ')
    ax.set_xlabel('3D SNR (σ)');  ax.set_ylabel('Density')
    ax.legend(fontsize=7)

    # ── C: SNR tier pie ────────────────────────────────────────────────────
    ax = fig.add_subplot(gs[0, 2])
    label_axes(ax, 'C')
    ax.set_title('Particle Quality Composition')
    tier_counts = [int((arrs['tier'] == i).sum()) for i in range(len(TIER_COLORS))]
    non_zero = [(c, TIER_COLORS[i], TIER_LABELS[i]) for i, c in enumerate(tier_counts) if c > 0]
    wedge_colors  = [x[1] for x in non_zero]
    wedge_labels  = [f"{x[2]}\n{x[0]:,}" for x in non_zero]
    wedge_sizes   = [x[0] for x in non_zero]
    wedges, _ = ax.pie(wedge_sizes, colors=wedge_colors, startangle=90,
                       wedgeprops={'edgecolor': DARK_BG, 'linewidth': 1.5})
    ax.legend(wedges, wedge_labels, loc='lower center', bbox_to_anchor=(0.5, -0.22),
              ncol=2, fontsize=7)
    ax.text(0, 0, f'{n:,}\nparticles', ha='center', va='center',
            fontsize=9, fontweight='bold', color=TEXT_COL)

    # ── D: Cumulative extraction curve ─────────────────────────────────────
    ax = fig.add_subplot(gs[1, :2])
    label_axes(ax, 'D')
    ax.set_title('Extraction Threshold Guide — Cumulative Particles vs Score Cutoff')
    snr_sorted = np.sort(snr)[::-1]
    cumulative  = np.arange(1, len(snr_sorted)+1)
    ax.plot(snr_sorted, cumulative / n * 100, color=ACCENT, lw=2.5, label='% kept')
    ax.set_xlabel('Minimum SNR threshold (σ)')
    ax.set_ylabel('% particles kept', color=ACCENT)
    ax.tick_params(axis='y', labelcolor=ACCENT)
    # Right axis: absolute count
    ax2 = ax.twinx()
    ax2.plot(snr_sorted, cumulative, color=GREEN, lw=1.5, ls='--', alpha=0.7, label='count')
    ax2.set_ylabel('N particles', color=GREEN)
    ax2.tick_params(axis='y', labelcolor=GREEN)
    ax2.yaxis.label.set_color(GREEN)
    # Tier vertical lines
    for lo, col, lab in zip(TIER_BOUNDS[1:-1], TIER_COLORS[1:], TIER_LABELS[1:]):
        ax.axvline(lo, color=col, ls=':', lw=1.2, alpha=0.7)
        ax.text(lo+0.1, 95, lab, color=col, fontsize=7, va='top')
    # Suggested cutoffs
    for pct, col, lab in [(90, YELLOW, '90%'), (75, ORANGE, '75%'), (50, RED, '50%')]:
        thresh_idx = np.searchsorted(cumulative[::-1], int(n*(1-pct/100)))
        if thresh_idx < len(snr_sorted):
            t = snr_sorted[::-1][thresh_idx]
            ax.axvline(t, color=col, ls='-', lw=1, alpha=0.6)
            ax.text(t+0.05, pct, f'{lab}→{t:.1f}σ', color=col, fontsize=7)
    ax.set_xlim(left=0);  ax.set_ylim(0, 105)
    lines1, labs1 = ax.get_legend_handles_labels()
    lines2, labs2 = ax2.get_legend_handles_labels()
    ax.legend(lines1+lines2, labs1+labs2, loc='upper right', fontsize=8)

    # ── E: Score rank plot (scorify-style) ─────────────────────────────────
    ax = fig.add_subplot(gs[1, 2])
    label_axes(ax, 'E')
    ax.set_title('Score Rank Plot (Scorify-style)')
    rank = np.arange(1, n+1)
    lcc_s = np.sort(lcc)[::-1]
    tier_s = assign_tiers(np.where(arrs['std'] > 0, lcc_s / np.sort(arrs['std'])[::-1], 0))
    scatter = ax.scatter(rank, lcc_s, c=[TIER_COLORS[t] for t in tier_s],
                         s=1.5, alpha=0.6, rasterized=True)
    ax.set_xlabel('Particle rank (by score)');  ax.set_ylabel('LCCmax')
    ax.set_xscale('log')
    # Add tier legend patches
    from matplotlib.patches import Patch
    ax.legend([Patch(color=c) for c in TIER_COLORS],
              TIER_LABELS, fontsize=7, loc='upper right')

    # Recommendation text
    med_snr = np.median(snr)
    pct_good = 100 * (snr >= 10).sum() / n
    reco = (f"Median SNR {med_snr:.1f}σ  |  {pct_good:.0f}% ≥10σ  |  "
            f"Suggested extraction cutoff: ~{np.percentile(snr,25):.1f}σ (bottom quartile)")
    add_recommendation(fig, reco)

    fig.savefig(f'{prefix}_1_score_landscape.png')
    fig.savefig(f'{prefix}_1_score_landscape.pdf')
    # Interactive JSON — SNR histogram + cumulative
    try:
        snr_clip_list = np.clip(snr, 0, 30).tolist()
        snr_sorted_list = np.sort(snr)[::-1].tolist()
        cum_pct = (np.arange(1, len(snr_sorted_list)+1) / len(snr_sorted_list) * 100).tolist()
        traces_1 = [
            {'type': 'histogram', 'x': snr_clip_list, 'nbinsx': 60,
             'name': 'SNR', 'marker': {'color': '#3fb950', 'opacity': 0.7},
             'xaxis': 'x', 'yaxis': 'y'},
            {'type': 'scatter', 'x': snr_sorted_list, 'y': cum_pct,
             'name': '% kept', 'mode': 'lines', 'line': {'color': '#58a6ff', 'width': 2},
             'xaxis': 'x2', 'yaxis': 'y2'},
        ]
        layout_1 = {
            'title': {'text': 'Score Landscape — SNR Distribution & Cumulative Extraction'},
            'grid': {'rows': 1, 'columns': 2, 'pattern': 'independent'},
            'xaxis': {'title': 'SNR (σ)'},  'yaxis': {'title': 'Count'},
            'xaxis2': {'title': 'SNR threshold (σ)'}, 'yaxis2': {'title': '% particles kept'},
            'showlegend': True,
        }
        save_interactive_json(prefix, '1_score_landscape', traces_1, layout_1)
    except Exception as e:
        print(f"  (Interactive JSON skipped: {e})")
    plt.close(fig)
    print(f"  Saved Fig 1: {prefix}_1_score_landscape")


# ============================================================================
# Figure 2 — Per-Tomogram Quality
# ============================================================================
def fig_per_tomo(arrs, prefix):
    snr = arrs['snr'];  tomos = arrs['tomo']
    unique_tomos = np.unique(tomos)
    n_tomos = len(unique_tomos)

    # Per-tomo stats
    tomo_data = {}
    for t in unique_tomos:
        m = tomos == t
        s = snr[m]
        tomo_data[t] = {'snr': s, 'mean': s.mean(), 'med': np.median(s),
                        'n': m.sum(), 'std': s.std()}
    sorted_tomos = sorted(tomo_data, key=lambda t: tomo_data[t]['mean'], reverse=True)
    short = lambda t: t.replace('.tomostar','').split('/')[-1][:28]

    fig = plt.figure(figsize=(18, 12))
    fig.suptitle(f'Figure 2 — Per-Tomogram Quality ({n_tomos} tomograms)', y=0.98)
    gs = gridspec.GridSpec(2, 3, figure=fig, hspace=0.45, wspace=0.38)

    # ── A: Horizontal bar chart — mean SNR ranked ──────────────────────────
    show = min(30, n_tomos)
    ax = fig.add_subplot(gs[:, 0])
    label_axes(ax, 'A')
    ax.set_title(f'Top {show} Tomograms by Mean SNR')
    top_tomos = sorted_tomos[:show]
    means = [tomo_data[t]['mean'] for t in top_tomos]
    stds  = [tomo_data[t]['std']  for t in top_tomos]
    colors = [TIER_COLORS[min(get_tier(m), len(TIER_COLORS)-1)] for m in means]
    y_pos = np.arange(show)
    bars = ax.barh(y_pos, means, xerr=stds, color=colors, alpha=0.8,
                   edgecolor=DARK_BG, linewidth=0.5, error_kw={'ecolor': DIM_COL, 'lw': 0.8})
    ax.set_yticks(y_pos)
    ax.set_yticklabels([f'{short(t)}  (n={tomo_data[t]["n"]})' for t in top_tomos], fontsize=7)
    ax.invert_yaxis()
    ax.set_xlabel('Mean 3D SNR (σ)')
    for b_val in [5, 7, 10, 15]:
        ax.axvline(b_val, color=TIER_COLORS[get_tier(b_val)], ls=':', lw=1, alpha=0.5)

    # ── B: Bottom tomograms ────────────────────────────────────────────────
    ax = fig.add_subplot(gs[:, 1])
    label_axes(ax, 'B')
    bot_tomos = sorted_tomos[-show:][::-1]
    means2 = [tomo_data[t]['mean'] for t in bot_tomos]
    stds2  = [tomo_data[t]['std']  for t in bot_tomos]
    colors2 = [TIER_COLORS[min(get_tier(m), len(TIER_COLORS)-1)] for m in means2]
    ax.set_title(f'Bottom {show} Tomograms by Mean SNR')
    ax.barh(y_pos[:len(bot_tomos)], means2, xerr=stds2, color=colors2, alpha=0.8,
            edgecolor=DARK_BG, linewidth=0.5, error_kw={'ecolor': DIM_COL, 'lw': 0.8})
    ax.set_yticks(y_pos[:len(bot_tomos)])
    ax.set_yticklabels([f'{short(t)}  (n={tomo_data[t]["n"]})' for t in bot_tomos], fontsize=7)
    ax.invert_yaxis()
    ax.set_xlabel('Mean 3D SNR (σ)')
    for b_val in [5, 7, 10, 15]:
        ax.axvline(b_val, color=TIER_COLORS[get_tier(b_val)], ls=':', lw=1, alpha=0.5)

    # ── C: Particle count distribution ────────────────────────────────────
    ax = fig.add_subplot(gs[0, 2])
    label_axes(ax, 'C')
    ax.set_title('Particles per Tomogram')
    counts = [tomo_data[t]['n'] for t in unique_tomos]
    ax.hist(counts, bins=30, color=ACCENT, alpha=0.75, edgecolor=DARK_BG)
    ax.axvline(np.median(counts), color=YELLOW, ls='--', lw=1.5, label=f'median {int(np.median(counts))}')
    ax.set_xlabel('N particles');  ax.set_ylabel('N tomograms')
    ax.legend()

    # ── D: Mean SNR distribution across tomos ─────────────────────────────
    ax = fig.add_subplot(gs[1, 2])
    label_axes(ax, 'D')
    ax.set_title('Mean SNR Distribution across Tomograms')
    all_means = [tomo_data[t]['mean'] for t in unique_tomos]
    ax.hist(all_means, bins=30, color=GREEN, alpha=0.75, edgecolor=DARK_BG)
    ax.axvline(np.median(all_means), color=YELLOW, ls='--', lw=1.5,
               label=f'median {np.median(all_means):.1f}σ')
    for b_val in [5, 7, 10, 15]:
        ax.axvline(b_val, color=TIER_COLORS[get_tier(b_val)], ls=':', lw=1, alpha=0.6)
    ax.set_xlabel('Mean SNR (σ)');  ax.set_ylabel('N tomograms')
    ax.legend()

    # Recommendation
    bad = sum(1 for t in unique_tomos if tomo_data[t]['mean'] < 7)
    reco = (f"{n_tomos} tomograms — {bad} below 7σ mean SNR (consider excluding) — "
            f"SNR spread: {min(all_means):.1f}–{max(all_means):.1f}σ")
    add_recommendation(fig, reco)

    fig.savefig(f'{prefix}_2_per_tomogram.png')
    fig.savefig(f'{prefix}_2_per_tomogram.pdf')
    try:
        s_tomos = sorted_tomos[:min(50, n_tomos)]
        short_names = [short(t) for t in s_tomos]
        means_list = [tomo_data[t]['mean'] for t in s_tomos]
        stds_list  = [tomo_data[t]['std']  for t in s_tomos]
        colors_list = [TIER_COLORS[min(get_tier(m), len(TIER_COLORS)-1)] for m in means_list]
        traces_2 = [{
            'type': 'bar', 'x': means_list, 'y': short_names,
            'orientation': 'h', 'name': 'Mean SNR',
            'error_x': {'type': 'data', 'array': stds_list, 'visible': True},
            'marker': {'color': colors_list, 'opacity': 0.85},
            'hovertemplate': '%{y}<br>Mean SNR: %{x:.2f}σ<extra></extra>',
        }]
        layout_2 = {
            'title': {'text': 'Per-Tomogram Mean SNR (top 50)'},
            'xaxis': {'title': 'Mean SNR (σ)'}, 'yaxis': {'autorange': 'reversed'},
            'height': max(400, min(50*len(s_tomos), 1200)),
        }
        save_interactive_json(prefix, '2_per_tomogram', traces_2, layout_2)
    except Exception as e:
        print(f"  (Interactive JSON skipped: {e})")
    plt.close(fig)
    print(f"  Saved Fig 2: {prefix}_2_per_tomogram")


# ============================================================================
# Figure 3 — Spatial Distribution & Edge Effects
# ============================================================================
def fig_spatial(arrs, prefix):
    x=arrs['x']; y=arrs['y']; z=arrs['z']; snr=arrs['snr']
    n = len(x)

    fig = plt.figure(figsize=(18, 12))
    fig.suptitle('Figure 3 — Spatial Distribution & Edge/Boundary Effects', y=0.98)
    gs = gridspec.GridSpec(2, 3, figure=fig, hspace=0.42, wspace=0.35)

    vmin, vmax = np.percentile(snr, 5), np.percentile(snr, 95)
    cmap = LinearSegmentedColormap.from_list('snr',
           ['#d32f2f', '#f57c00', '#fbc02d', '#388e3c', '#1565c0'])
    idx = np.random.choice(n, min(n, 50000), replace=False)

    projs = [('XY', x, y, 'X (px)', 'Y (px)'),
             ('XZ', x, z, 'X (px)', 'Z (px)'),
             ('YZ', y, z, 'Y (px)', 'Z (px)')]
    for i, (name, px, py, xl, yl) in enumerate(projs):
        ax = fig.add_subplot(gs[0, i])
        label_axes(ax, chr(65+i))
        ax.set_title(f'{name} Projection (colored by SNR)')
        sc = ax.scatter(px[idx], py[idx], c=snr[idx], cmap=cmap,
                        vmin=vmin, vmax=vmax, s=1.2, alpha=0.3, rasterized=True)
        plt.colorbar(sc, ax=ax, label='SNR (σ)', shrink=0.8)
        ax.set_xlabel(xl);  ax.set_ylabel(yl)

    # ── D: Z-depth histogram ──────────────────────────────────────────────
    ax = fig.add_subplot(gs[1, 0])
    label_axes(ax, 'D')
    ax.set_title('Z-Depth Distribution')
    ax.hist(z, bins=60, color=PURPLE, alpha=0.75, orientation='horizontal', edgecolor=DARK_BG)
    ax.set_xlabel('Count');  ax.set_ylabel('Z (px)')

    # ── E: SNR vs Z (missing wedge edge effect) ───────────────────────────
    ax = fig.add_subplot(gs[1, 1])
    label_axes(ax, 'E')
    ax.set_title('SNR vs Z — Missing Wedge Edge Check')
    sc = ax.scatter(z[idx], snr[idx], c=snr[idx], cmap=cmap,
                    vmin=vmin, vmax=vmax, s=1.5, alpha=0.25, rasterized=True)
    # Running median
    z_sort  = np.sort(np.unique(z.astype(int)))
    z_bins  = np.linspace(z.min(), z.max(), 30)
    bin_med = []
    for j in range(len(z_bins)-1):
        m = (z >= z_bins[j]) & (z < z_bins[j+1])
        if m.sum() > 2:
            bin_med.append((0.5*(z_bins[j]+z_bins[j+1]), np.median(snr[m])))
    if bin_med:
        bz, bm = zip(*bin_med)
        ax.plot(bz, bm, color=YELLOW, lw=2, label='running median')
        ax.legend(fontsize=8)
    plt.colorbar(sc, ax=ax, label='SNR (σ)', shrink=0.8)
    ax.set_xlabel('Z (px)');  ax.set_ylabel('SNR (σ)')
    ax.axhline(7, color=TIER_COLORS[2], ls=':', lw=1, alpha=0.6, label='7σ')
    ax.axhline(10, color=TIER_COLORS[3], ls=':', lw=1, alpha=0.6, label='10σ')

    # ── F: 2D density (XY) ────────────────────────────────────────────────
    ax = fig.add_subplot(gs[1, 2])
    label_axes(ax, 'F')
    ax.set_title('Particle Density Map (XY)')
    h = ax.hist2d(x, y, bins=[60, 60], cmap='magma', cmin=1)
    plt.colorbar(h[3], ax=ax, label='Count')
    ax.set_xlabel('X (px)');  ax.set_ylabel('Y (px)')
    ax.set_aspect('equal')

    fig.savefig(f'{prefix}_3_spatial.png')
    fig.savefig(f'{prefix}_3_spatial.pdf')
    plt.close(fig)
    print(f"  Saved Fig 3: {prefix}_3_spatial")


# ============================================================================
# Figure 4 — Orientation Coverage
# ============================================================================
def fig_orientations(arrs, prefix):
    rots=arrs['rot']; tilts=arrs['tilt']; psis=arrs['psi']; snr=arrs['snr']
    tiers = arrs['tier']
    populated = [(i, TIER_COLORS[i], TIER_LABELS[i])
                 for i in range(len(TIER_COLORS)) if (tiers==i).sum() > 10]

    # Compute orientation efficiency (Naydenova & Russo 2017)
    theta = np.radians(tilts)
    phi   = np.radians(rots)
    vx, vy, vz = np.sin(theta)*np.cos(phi), np.sin(theta)*np.sin(phi), np.cos(theta)
    bins_t  = np.linspace(0, np.pi, 37)
    obs, _  = np.histogram(theta, bins=bins_t)
    centers = 0.5*(bins_t[:-1]+bins_t[1:])
    exp     = np.sin(centers); exp = exp/exp.sum()*obs.sum()
    chi2    = np.nansum((obs-exp)**2/(exp+1e-10))
    chi2max = np.nansum(exp**2/(exp+1e-10))
    eff     = max(0, 1 - chi2/(chi2max+1e-10))

    fig = plt.figure(figsize=(18, 12))
    fig.suptitle(f'Figure 4 — Orientation Coverage  (efficiency={eff:.3f})', y=0.98)
    gs = gridspec.GridSpec(2, 3, figure=fig, hspace=0.48, wspace=0.38)

    # ── A: Mollweide projection (all particles) ───────────────────────────
    ax = fig.add_subplot(gs[0, :2], projection='mollweide')
    label_axes(ax, 'A', x=-0.04)
    ax.set_title('Mollweide — Orientation Coverage')
    theta_m = np.pi/2 - theta   # latitude = 90° - tilt
    phi_m   = phi - np.pi       # shift to [-π, π]
    phi_m   = (phi_m + np.pi) % (2*np.pi) - np.pi
    cmap = LinearSegmentedColormap.from_list('snr',
           ['#d32f2f','#f57c00','#fbc02d','#388e3c','#1565c0'])
    idx2 = np.random.choice(len(snr), min(len(snr),5000), replace=False)
    sc = ax.scatter(phi_m[idx2], theta_m[idx2], c=snr[idx2],
                    cmap=cmap, s=3, alpha=0.4, rasterized=True,
                    vmin=np.percentile(snr,5), vmax=np.percentile(snr,95))
    plt.colorbar(sc, ax=ax, label='SNR (σ)', shrink=0.7, pad=0.07)
    ax.grid(True, color=GRID_COL, alpha=0.4)
    ax.set_xlabel('Azimuth (rad)');  ax.set_ylabel('Elevation (rad)')

    # ── B: Tilt (theta) distribution ─────────────────────────────────────
    ax = fig.add_subplot(gs[0, 2])
    label_axes(ax, 'B')
    ax.set_title('Tilt Angle (θ) Distribution')
    for ti, col, lab in populated:
        m = tiers == ti
        ax.hist(tilts[m], bins=36, color=col, alpha=0.35, density=True, label=lab)
    ax.set_xlabel('AngleTilt θ (°)');  ax.set_ylabel('Density')
    ax.legend(fontsize=7, ncol=2)

    # ── C: Rot (phi) distribution ─────────────────────────────────────────
    ax = fig.add_subplot(gs[1, 0])
    label_axes(ax, 'C')
    ax.set_title('Rot Angle (φ) Distribution')
    for ti, col, lab in populated:
        m = tiers == ti
        ax.hist(rots[m], bins=36, color=col, alpha=0.35, density=True, label=lab)
    ax.set_xlabel('AngleRot φ (°)');  ax.set_ylabel('Density')
    ax.legend(fontsize=7, ncol=2)

    # ── D: Psi distribution ───────────────────────────────────────────────
    ax = fig.add_subplot(gs[1, 1])
    label_axes(ax, 'D')
    ax.set_title('Psi (ψ) Distribution')
    for ti, col, lab in populated:
        m = tiers == ti
        ax.hist(psis[m], bins=72, color=col, alpha=0.35, density=True, label=lab)
    ax.axhline(1/360, color=DIM_COL, ls='--', lw=1.5, label='uniform')
    ax.set_xlabel('AnglePsi ψ (°)');  ax.set_ylabel('Density')
    ax.legend(fontsize=7, ncol=2)

    # ── E: Efficiency gauge ───────────────────────────────────────────────
    ax = fig.add_subplot(gs[1, 2])
    label_axes(ax, 'E')
    ax.set_title('Orientation Uniformity Score')
    ax.set_xlim(0, 1);  ax.set_ylim(0, 1);  ax.set_aspect('equal')
    ax.axis('off')
    # Semicircle gauge
    for start, stop, col in [(0, 0.33, RED), (0.33, 0.66, YELLOW), (0.66, 1.0, GREEN)]:
        theta_arc = np.linspace(np.pi * (1 - stop), np.pi * (1 - start), 50)
        ax.fill_between(0.5 + 0.38*np.cos(theta_arc), 0.2 + 0.38*np.sin(theta_arc),
                        0.2 + 0.3*np.cos(theta_arc[::-1]), 0.2 + 0.3*np.sin(theta_arc[::-1]),
                        alpha=0.3, color=col)
    # Needle
    angle = np.pi * (1 - eff)
    ax.annotate('', xy=(0.5 + 0.32*np.cos(angle), 0.2 + 0.32*np.sin(angle)),
                xytext=(0.5, 0.2),
                arrowprops=dict(arrowstyle='->', color=TEXT_COL, lw=2))
    col_eff = GREEN if eff > 0.66 else (YELLOW if eff > 0.33 else RED)
    ax.text(0.5, 0.55, f'{eff:.3f}', ha='center', va='center',
            fontsize=22, fontweight='bold', color=col_eff)
    ax.text(0.5, 0.42, 'orientation\nuniformity', ha='center', va='center',
            fontsize=9, color=DIM_COL)
    ax.text(0.05, 0.12, 'biased', fontsize=8, color=RED, ha='center')
    ax.text(0.5,  0.05, 'moderate', fontsize=8, color=YELLOW, ha='center')
    ax.text(0.95, 0.12, 'uniform', fontsize=8, color=GREEN, ha='center')

    reco = (f"Orientation efficiency {eff:.3f} — "
            + ("Good angular coverage. " if eff > 0.5 else "Possible missing-wedge bias. ")
            + "Check tilt distribution: particles near 0° or 180° may be false positives.")
    add_recommendation(fig, reco)

    fig.savefig(f'{prefix}_4_orientations.png')
    fig.savefig(f'{prefix}_4_orientations.pdf')
    plt.close(fig)
    print(f"  Saved Fig 4: {prefix}_4_orientations")


# ============================================================================
# Figure 5 — Nearest-Neighbour & Crowding Analysis
# ============================================================================
def fig_neighbors(arrs, prefix):
    x=arrs['x']; y=arrs['y']; z=arrs['z']
    snr=arrs['snr']; tomos=arrs['tomo']
    unique_tomos = np.unique(tomos)

    print("  Computing nearest-neighbour distances (may take a moment)...")
    nn_dists = []
    nn_snr   = []
    for t in unique_tomos:
        m = tomos == t
        pts = np.stack([x[m], y[m], z[m]], axis=1).astype(np.float32)
        s   = snr[m]
        n   = len(pts)
        if n < 2:
            continue
        for i in range(n):
            diffs = pts - pts[i]
            dists = np.sqrt((diffs**2).sum(axis=1))
            dists[i] = np.inf
            nn_dists.append(dists.min())
            nn_snr.append(s[i])
    nn_dists = np.array(nn_dists)
    nn_snr   = np.array(nn_snr)

    fig = plt.figure(figsize=(16, 8))
    fig.suptitle('Figure 5 — Nearest-Neighbour Distance & Crowding', y=0.98)
    gs = gridspec.GridSpec(1, 3, figure=fig, hspace=0.35, wspace=0.38)

    # ── A: NN distance histogram ──────────────────────────────────────────
    ax = fig.add_subplot(gs[0])
    label_axes(ax, 'A')
    ax.set_title('Nearest-Neighbour Distance Distribution')
    clip_val = np.percentile(nn_dists, 99)
    ax.hist(nn_dists[nn_dists <= clip_val], bins=60, color=ACCENT, alpha=0.75,
            edgecolor=DARK_BG, density=True)
    med = np.median(nn_dists)
    ax.axvline(med, color=YELLOW, ls='--', lw=1.5, label=f'median {med:.1f} px')
    # Crowding threshold (typically ~particle_radius)
    p10 = np.percentile(nn_dists, 10)
    ax.axvline(p10, color=RED, ls='--', lw=1.5, label=f'P10 {p10:.1f} px')
    ax.set_xlabel('Nearest-neighbour distance (px)');  ax.set_ylabel('Density')
    ax.legend()

    # ── B: NN dist vs SNR ─────────────────────────────────────────────────
    ax = fig.add_subplot(gs[1])
    label_axes(ax, 'B')
    ax.set_title('Crowding vs Score Quality')
    cmap = LinearSegmentedColormap.from_list('snr',
           ['#d32f2f','#f57c00','#fbc02d','#388e3c','#1565c0'])
    tiers = assign_tiers(nn_snr)
    idx = np.random.choice(len(nn_dists), min(len(nn_dists), 20000), replace=False)
    ax.scatter(nn_dists[idx], nn_snr[idx],
               c=[TIER_COLORS[min(t, len(TIER_COLORS)-1)] for t in tiers[idx]],
               s=1.5, alpha=0.4, rasterized=True)
    ax.axvline(p10, color=RED, ls='--', lw=1.2, alpha=0.7, label=f'P10 {p10:.1f}px')
    ax.set_xlabel('NN distance (px)');  ax.set_ylabel('SNR (σ)')
    ax.legend(fontsize=8)

    # ── C: Crowded fraction ──────────────────────────────────────────────
    ax = fig.add_subplot(gs[2])
    label_axes(ax, 'C')
    ax.set_title('Duplicate / Crowded Fraction vs Distance Threshold')
    thresholds = np.linspace(5, 80, 50)
    fracs = [100*(nn_dists < t).mean() for t in thresholds]
    ax.plot(thresholds, fracs, color=RED, lw=2)
    ax.fill_between(thresholds, fracs, alpha=0.15, color=RED)
    # Mark common extraction radii
    for r, lab in [(15, '15px'), (20, '20px'), (30, '30px')]:
        frac_r = 100*(nn_dists < r).mean()
        ax.axvline(r, color=YELLOW, ls=':', lw=1.2)
        ax.text(r+0.5, frac_r+1, f'{lab}\n{frac_r:.1f}%', fontsize=7, color=YELLOW)
    ax.set_xlabel('Distance threshold (px)')
    ax.set_ylabel('% particles with NN closer than threshold')
    ax.set_ylim(0, 100)

    crowded_pct = 100*(nn_dists < p10).mean()
    reco = (f"Median NN distance {med:.1f} px — "
            f"~{crowded_pct:.0f}% of particles have a very close neighbour (< {p10:.0f} px). "
            "High crowding suggests duplicate picks or high extraction density — consider applying a minimum distance filter.")
    add_recommendation(fig, reco)

    fig.savefig(f'{prefix}_5_neighbors.png')
    fig.savefig(f'{prefix}_5_neighbors.pdf')
    try:
        idx_s = np.random.choice(len(nn_dists), min(len(nn_dists), 5000), replace=False)
        traces_5 = [
            {'type': 'histogram', 'x': nn_dists[nn_dists<=np.percentile(nn_dists,99)].tolist(),
             'name': 'NN distance', 'nbinsx': 60, 'marker': {'color': '#58a6ff', 'opacity': 0.75},
             'hovertemplate': 'Distance: %{x:.1f} px<br>Count: %{y}<extra></extra>'},
            {'type': 'scatter', 'x': nn_dists[idx_s].tolist(), 'y': nn_snr[idx_s].tolist(),
             'mode': 'markers', 'name': 'NN dist vs SNR',
             'marker': {'color': nn_snr[idx_s].tolist(), 'colorscale': 'Viridis',
                       'size': 3, 'opacity': 0.4, 'showscale': True,
                       'colorbar': {'title': 'SNR', 'thickness': 10}},
             'xaxis': 'x2', 'yaxis': 'y2',
             'hovertemplate': 'NN dist: %{x:.1f}px<br>SNR: %{y:.1f}σ<extra></extra>'},
        ]
        layout_5 = {
            'title': {'text': 'Nearest-Neighbour Distances'},
            'grid': {'rows': 1, 'columns': 2, 'pattern': 'independent'},
            'xaxis': {'title': 'NN distance (px)'}, 'yaxis': {'title': 'Count'},
            'xaxis2': {'title': 'NN distance (px)'}, 'yaxis2': {'title': 'SNR (σ)'},
        }
        save_interactive_json(prefix, '5_neighbors', traces_5, layout_5)
    except Exception as e:
        print(f"  (Interactive JSON skipped: {e})")
    plt.close(fig)
    print(f"  Saved Fig 5: {prefix}_5_neighbors")


# ============================================================================
# Figure 6 — Geometry & Missing Wedge Bias
# ============================================================================
def fig_geometry(arrs, prefix):
    tilts=arrs['tilt']; rots=arrs['rot']
    lcc=arrs['lcc']; snr=arrs['snr']; z=arrs['z']

    fig = plt.figure(figsize=(16, 10))
    fig.suptitle('Figure 6 — Geometry Bias: Missing Wedge & Tilt Correlation', y=0.98)
    gs = gridspec.GridSpec(2, 3, figure=fig, hspace=0.45, wspace=0.38)
    cmap_snr = LinearSegmentedColormap.from_list('snr',
               ['#d32f2f','#f57c00','#fbc02d','#388e3c','#1565c0'])
    vmin, vmax = np.percentile(snr, 5), np.percentile(snr, 95)

    # ── A: LCCmax vs tilt angle ────────────────────────────────────────────
    ax = fig.add_subplot(gs[0, 0])
    label_axes(ax, 'A')
    ax.set_title('LCCmax vs Tilt Angle')
    idx = np.random.choice(len(snr), min(len(snr), 20000), replace=False)
    sc  = ax.scatter(tilts[idx], lcc[idx], c=snr[idx], cmap=cmap_snr,
                     vmin=vmin, vmax=vmax, s=1.5, alpha=0.3, rasterized=True)
    plt.colorbar(sc, ax=ax, label='SNR (σ)', shrink=0.8)
    # Running median
    tb = np.linspace(0, 180, 25)
    meds = [(0.5*(tb[i]+tb[i+1]), np.median(lcc[(tilts>=tb[i])&(tilts<tb[i+1])]))
            for i in range(len(tb)-1) if ((tilts>=tb[i])&(tilts<tb[i+1])).sum()>5]
    if meds:
        tt, mm = zip(*meds)
        ax.plot(tt, mm, color=YELLOW, lw=2, label='running median')
        ax.legend(fontsize=8)
    ax.set_xlabel('AngleTilt (°)');  ax.set_ylabel('LCCmax')

    # ── B: SNR vs tilt angle ──────────────────────────────────────────────
    ax = fig.add_subplot(gs[0, 1])
    label_axes(ax, 'B')
    ax.set_title('SNR vs Tilt Angle')
    ax.scatter(tilts[idx], snr[idx], c=snr[idx], cmap=cmap_snr,
               vmin=vmin, vmax=vmax, s=1.5, alpha=0.3, rasterized=True)
    # Expected: near-90° tilts should show lower LCC (missing wedge)
    ax.axhline(7, color=TIER_COLORS[2], ls=':', lw=1, alpha=0.7, label='7σ')
    ax.axhline(10, color=TIER_COLORS[3], ls=':', lw=1, alpha=0.7, label='10σ')
    ax.axvline(90, color=DIM_COL, ls='--', lw=1, alpha=0.5, label='90° (missing wedge)')
    ax.set_xlabel('AngleTilt (°)');  ax.set_ylabel('SNR (σ)')
    ax.legend(fontsize=7)

    # ── C: 2D heatmap rot vs tilt ─────────────────────────────────────────
    ax = fig.add_subplot(gs[0, 2])
    label_axes(ax, 'C')
    ax.set_title('Euler Angle Map (φ vs θ) — missing regions visible')
    h = ax.hist2d(rots, tilts, bins=[36, 18], cmap='inferno', cmin=1)
    plt.colorbar(h[3], ax=ax, label='Count')
    ax.set_xlabel('AngleRot φ (°)');  ax.set_ylabel('AngleTilt θ (°)')

    # ── D: LCCmax vs Z ────────────────────────────────────────────────────
    ax = fig.add_subplot(gs[1, 0])
    label_axes(ax, 'D')
    ax.set_title('LCCmax vs Z — Edge Effect Check')
    ax.scatter(z[idx], lcc[idx], c=snr[idx], cmap=cmap_snr,
               vmin=vmin, vmax=vmax, s=1.5, alpha=0.3, rasterized=True)
    ax.set_xlabel('Z (px)');  ax.set_ylabel('LCCmax')

    # ── E: SNR polar plot (azimuthal preference) ──────────────────────────
    ax = fig.add_subplot(gs[1, 1], projection='polar')
    label_axes(ax, 'E', x=-0.05)
    ax.set_title('Azimuthal SNR Profile (Rot angle)')
    phi_rad = np.radians(rots)
    phi_bins = np.linspace(0, 2*np.pi, 37)
    phi_meds = []
    for i in range(len(phi_bins)-1):
        m = (phi_rad >= phi_bins[i]) & (phi_rad < phi_bins[i+1])
        phi_meds.append(np.median(snr[m]) if m.sum() > 0 else 0)
    phi_cen = 0.5*(phi_bins[:-1]+phi_bins[1:])
    phi_meds = np.array(phi_meds + [phi_meds[0]])  # close the ring
    phi_cen  = np.append(phi_cen, phi_cen[0])
    ax.plot(phi_cen, phi_meds, color=ACCENT, lw=2)
    ax.fill(phi_cen, phi_meds, alpha=0.15, color=ACCENT)
    ax.set_theta_zero_location('N');  ax.set_theta_direction(-1)
    ax.tick_params(colors=DIM_COL)

    # ── F: Particle count vs tilt angle band ─────────────────────────────
    ax = fig.add_subplot(gs[1, 2])
    label_axes(ax, 'F')
    ax.set_title('Particle Count vs Tilt Band')
    tilt_bins = np.arange(0, 185, 10)
    counts = [((tilts>=tilt_bins[i])&(tilts<tilt_bins[i+1])).sum()
              for i in range(len(tilt_bins)-1)]
    centers = 0.5*(tilt_bins[:-1]+tilt_bins[1:])
    bar_col = [TIER_COLORS[get_tier(np.median(snr[(tilts>=tilt_bins[i])&(tilts<tilt_bins[i+1])]))]
               if ((tilts>=tilt_bins[i])&(tilts<tilt_bins[i+1])).sum()>0 else DIM_COL
               for i in range(len(tilt_bins)-1)]
    ax.bar(centers, counts, width=9, color=bar_col, alpha=0.8, edgecolor=DARK_BG)
    ax.axvline(90, color=DIM_COL, ls='--', lw=1, label='90° missing wedge')
    ax.set_xlabel('AngleTilt (°)');  ax.set_ylabel('N particles')
    ax.legend(fontsize=8)

    # Check for missing wedge bias
    near_90 = snr[(tilts > 75) & (tilts < 105)]
    away_90 = snr[(tilts < 75) | (tilts > 105)]
    bias_note = ""
    if len(near_90) > 10 and len(away_90) > 10:
        diff = away_90.mean() - near_90.mean()
        bias_note = f"  |  Near-90° SNR {near_90.mean():.1f}σ vs rest {away_90.mean():.1f}σ (diff {diff:+.1f}σ)"

    reco = ("Missing wedge effect: particles near θ=90° may have lower LCCmax due to incomplete angular coverage." + bias_note)
    add_recommendation(fig, reco)

    fig.savefig(f'{prefix}_6_geometry.png')
    fig.savefig(f'{prefix}_6_geometry.pdf')
    plt.close(fig)
    print(f"  Saved Fig 6: {prefix}_6_geometry")


# ============================================================================
# Figure 7 — Extraction Decision Panel
# ============================================================================
def fig_extraction_guide(arrs, prefix):
    """
    Actionable decision panel for particle extraction.
    Shows particle yield vs purity trade-off curves.
    """
    snr = arrs['snr'];  lcc = arrs['lcc'];  n = len(snr)
    tomos = arrs['tomo'];  unique_tomos = np.unique(tomos)

    fig = plt.figure(figsize=(16, 10))
    fig.suptitle('Figure 7 — Extraction Decision Panel', y=0.98)
    gs = gridspec.GridSpec(2, 3, figure=fig, hspace=0.45, wspace=0.4)

    # ── A: Yield vs purity trade-off ──────────────────────────────────────
    ax = fig.add_subplot(gs[0, :2])
    label_axes(ax, 'A')
    ax.set_title('Particle Yield vs Score Threshold — RELION Extraction Guide')
    thresholds = np.linspace(snr.min(), snr.max(), 200)
    yields = [100*(snr >= t).mean() for t in thresholds]
    ax.plot(thresholds, yields, color=ACCENT, lw=2.5, label='% particles kept')
    ax.fill_between(thresholds, yields, alpha=0.1, color=ACCENT)
    ax.set_xlabel('SNR threshold (σ)');  ax.set_ylabel('% particles kept', color=ACCENT)
    ax.tick_params(axis='y', labelcolor=ACCENT)
    # Mark standard operating points
    ops = [
        (np.percentile(snr, 0),   GREEN,  'All (0%)'),
        (np.percentile(snr, 25),  YELLOW, 'Bottom 25% cut'),
        (np.percentile(snr, 50),  ORANGE, 'Bottom 50% cut'),
        (np.percentile(snr, 75),  RED,    'Bottom 75% cut'),
    ]
    for thr, col, lab in ops:
        ax.axvline(thr, color=col, ls='--', lw=1.2, alpha=0.8)
        pct = 100*(snr >= thr).mean()
        ax.text(thr+0.1, pct+2, f'{lab}\n({int(pct*n/100)} particles)', color=col, fontsize=7)
    # Tier lines
    for i, b in enumerate(TIER_BOUNDS[1:-1]):
        ax.axvline(b, color=TIER_COLORS[i+1], ls=':', lw=1, alpha=0.5)
    ax.set_xlim(snr.min()-0.5, snr.max()+0.5);  ax.set_ylim(0, 105)

    # ── B: Per-tomo yield uniformity ──────────────────────────────────────
    ax = fig.add_subplot(gs[0, 2])
    label_axes(ax, 'B')
    ax.set_title('Per-Tomo Yield at Median Cutoff')
    med_thr = np.median(snr)
    tomo_yields = [100*(snr[tomos==t] >= med_thr).mean() for t in unique_tomos]
    ax.hist(tomo_yields, bins=20, color=GREEN, alpha=0.75, edgecolor=DARK_BG)
    ax.axvline(50, color=YELLOW, ls='--', lw=1.5, label='50%')
    ax.set_xlabel('% particles kept per tomo');  ax.set_ylabel('N tomograms')
    ax.legend()

    # ── C: RELION processing recommendation ──────────────────────────────
    ax = fig.add_subplot(gs[1, :2])
    label_axes(ax, 'C')
    ax.axis('off')
    ax.set_title('RELION Processing Recommendations', pad=10)

    med_snr = np.median(snr)
    pct_good = 100*(snr >= 10).sum()/n
    pct_weak = 100*((snr < 7) & (snr > 0)).sum()/n
    n_tomos_bad = sum(1 for t in unique_tomos
                      if len(snr[tomos==t]) > 0 and np.median(snr[tomos==t]) < 7)
    rec_cutoff = float(np.percentile(snr, 25))
    rec_n      = int((snr >= rec_cutoff).sum())

    recommendations = [
        ("Suggested SNR cutoff",
         f"{rec_cutoff:.1f}σ  →  {rec_n:,} particles ({100*rec_n/n:.0f}%)"),
        ("First RELION run",
         "LP filter 80Å, T=1, few iterations — align roughly, don't overfit"),
        ("Second RELION run",
         "LP filter 40Å, T=4 — remove junk, keep dominant class"),
        ("Particle density check",
         "Your target should be >50% of extracted particles (Less is More!)"),
        ("Handedness note",
         "Verify handedness vs known structure BEFORE full TM run"),
        ("Tomograms to check",
         f"{n_tomos_bad} tomos with median SNR < 7σ — consider excluding"),
        ("False positive risk",
         f"{pct_weak:.1f}% particles below 7σ — likely noise" if pct_weak > 5 else
         f"Low false positive risk ({pct_weak:.1f}% below 7σ)"),
    ]
    for i, (title, text) in enumerate(recommendations):
        y = 0.95 - i*0.135
        col = RED if 'check' in title.lower() or 'risk' in title.lower() else TEXT_COL
        ax.text(0.01, y, f"▸  {title}:", transform=ax.transAxes,
                fontsize=9, fontweight='bold', color=ACCENT, va='top')
        ax.text(0.3,  y, text, transform=ax.transAxes,
                fontsize=9, color=TEXT_COL, va='top')

    # ── D: Summary numbers ────────────────────────────────────────────────
    ax = fig.add_subplot(gs[1, 2])
    label_axes(ax, 'D')
    ax.axis('off')
    ax.set_title('Dataset Summary')
    stats = [
        ('Total particles',  f'{n:,}'),
        ('Tomograms',        f'{len(unique_tomos):,}'),
        ('Median SNR',       f'{med_snr:.2f}σ'),
        ('Mean SNR',         f'{snr.mean():.2f}σ'),
        ('SNR range',        f'{snr.min():.1f}–{snr.max():.1f}σ'),
        ('≥10σ (good)',      f'{pct_good:.1f}%'),
        ('<7σ (weak)',        f'{pct_weak:.1f}%'),
        ('LCCmax median',    f'{np.median(lcc):.4f}'),
        ('LCCmax range',     f'{lcc.min():.4f}–{lcc.max():.4f}'),
    ]
    for i, (k, v) in enumerate(stats):
        y = 0.94 - i*0.1
        ax.text(0.05, y, k+':', transform=ax.transAxes, fontsize=9, color=DIM_COL, va='top')
        ax.text(0.65, y, v,     transform=ax.transAxes, fontsize=9, color=TEXT_COL,
                fontweight='bold', va='top')

    fig.savefig(f'{prefix}_7_extraction_guide.png')
    fig.savefig(f'{prefix}_7_extraction_guide.pdf')
    plt.close(fig)
    print(f"  Saved Fig 7: {prefix}_7_extraction_guide")


# ============================================================================
# Figure 8 — Per-Tomogram SNR Heatmap
# ============================================================================
def fig_tomo_heatmap(arrs, prefix):
    """
    Visual heatmap of per-tomogram quality — quick overview of dataset
    heterogeneity, inspired by scorify.
    """
    snr = arrs['snr'];  tomos = arrs['tomo']
    unique_tomos = np.unique(tomos)
    n_tomos = len(unique_tomos)

    # Sort by mean SNR
    tomo_stats = sorted(
        {t: snr[tomos==t] for t in unique_tomos}.items(),
        key=lambda x: x[1].mean(), reverse=True)

    short = lambda t: t.replace('.tomostar','').split('/')[-1][:25]

    # Build matrix: tomos × SNR bins
    snr_edges = np.linspace(0, min(snr.max()*1.05, 30), 31)
    matrix    = np.zeros((n_tomos, 30))
    for i, (t, s) in enumerate(tomo_stats):
        hist, _ = np.histogram(s, bins=snr_edges)
        total   = hist.sum()
        if total > 0:
            matrix[i] = hist / total  # fraction

    fig_h = max(6, n_tomos * 0.22)
    fig   = plt.figure(figsize=(16, min(fig_h, 28)))
    fig.suptitle('Figure 8 — Per-Tomogram SNR Profile Heatmap', y=1.001)
    gs = gridspec.GridSpec(1, 2, figure=fig, wspace=0.05,
                           width_ratios=[0.82, 0.18])

    # ── A: Heatmap ────────────────────────────────────────────────────────
    ax = fig.add_subplot(gs[0])
    label_axes(ax, 'A')
    ax.set_title('SNR Distribution per Tomogram (normalized)')
    cmap_heat = LinearSegmentedColormap.from_list('heat',
                [DARK_BG, '#1565c0', '#388e3c', '#fbc02d', '#f57c00', '#d32f2f'])
    im = ax.imshow(matrix, aspect='auto', origin='upper',
                   extent=[snr_edges[0], snr_edges[-1], n_tomos-0.5, -0.5],
                   cmap=cmap_heat, vmin=0, vmax=matrix.max()*0.8)
    plt.colorbar(im, ax=ax, label='Fraction of particles', shrink=0.4, pad=0.02)
    # Tier vertical lines
    for b, col, lab in zip(TIER_BOUNDS[1:-1], TIER_COLORS[1:], TIER_LABELS[1:]):
        ax.axvline(b, color=col, ls='--', lw=1, alpha=0.7)
        ax.text(b+0.1, -0.2, lab, color=col, fontsize=7, va='top')
    ax.set_yticks(range(n_tomos))
    ax.set_yticklabels([short(t) for t, _ in tomo_stats], fontsize=max(5, 9-n_tomos//15))
    ax.set_xlabel('SNR (σ)')

    # ── B: Mean SNR bar ────────────────────────────────────────────────────
    ax2 = fig.add_subplot(gs[1])
    label_axes(ax2, 'B')
    ax2.set_title('Mean SNR')
    means = [s.mean() for _, s in tomo_stats]
    cols  = [TIER_COLORS[min(get_tier(m), len(TIER_COLORS)-1)] for m in means]
    ax2.barh(range(n_tomos), means, color=cols, alpha=0.8, edgecolor=DARK_BG, height=0.8)
    ax2.set_yticks([]);  ax2.set_ylim(-0.5, n_tomos-0.5)
    ax2.invert_yaxis()
    ax2.set_xlabel('Mean SNR (σ)')
    for b, col in zip(TIER_BOUNDS[1:-1], TIER_COLORS[1:]):
        ax2.axvline(b, color=col, ls=':', lw=1, alpha=0.5)

    fig.savefig(f'{prefix}_8_tomo_heatmap.png')
    fig.savefig(f'{prefix}_8_tomo_heatmap.pdf')
    plt.close(fig)
    print(f"  Saved Fig 8: {prefix}_8_tomo_heatmap")


# ============================================================================
# Console summary
# ============================================================================
def print_summary(arrs):
    snr = arrs['snr'];  lcc = arrs['lcc'];  n = len(snr)
    tomos = arrs['tomo'];  unique_tomos = np.unique(tomos)
    print(f"\n{'='*72}")
    print(f"  DATASET SUMMARY")
    print(f"{'='*72}")
    print(f"  Total particles  : {n:>10,}")
    print(f"  Tomograms        : {len(unique_tomos):>10,}")
    print(f"  Median SNR       : {np.median(snr):>10.2f}σ")
    print(f"  Mean SNR         : {snr.mean():>10.2f}σ")
    print(f"  LCCmax range     : {lcc.min():.4f} – {lcc.max():.4f}")
    print(f"\n  SNR TIER BREAKDOWN")
    print(f"  {'Tier':<22} {'N':>8} {'%':>7} {'Color'}")
    print(f"  {'-'*50}")
    for i, (lo, hi, col, desc) in enumerate(zip(
            TIER_BOUNDS, TIER_BOUNDS[1:], TIER_COLORS, TIER_DESCS)):
        m = (snr >= lo) & (snr < hi)
        c = m.sum()
        if c > 0:
            print(f"  {TIER_LABELS[i]+' '+desc:<30} {c:>8,} {100*c/n:>6.1f}%")
    print(f"\n  RECOMMENDATION: extract with SNR ≥ {np.percentile(snr,25):.1f}σ "
          f"({int((snr >= np.percentile(snr,25)).sum()):,} particles)")
    print(f"{'='*72}\n")


# ============================================================================
# MAIN
# ============================================================================
def save_interactive_json(prefix, key, traces, layout_extra=None):
    """Save Plotly-compatible JSON for browser interactive rendering."""
    import json as _json
    layout = {
        'title': {'text': '', 'font': {'size': 13, 'color': '#e6edf3'}},
        'paper_bgcolor': 'rgba(0,0,0,0)',
        'plot_bgcolor': '#161b22',
        'font': {'color': '#e6edf3', 'size': 11},
        'xaxis': {'gridcolor': '#21262d', 'zerolinecolor': '#21262d'},
        'yaxis': {'gridcolor': '#21262d', 'zerolinecolor': '#21262d'},
    }
    if layout_extra:
        layout.update(layout_extra)
    out = {'traces': traces, 'layout': layout}
    path = f'{prefix}_{key}_interactive.json'
    with open(path, 'w') as f:
        _json.dump(out, f, allow_nan=False, default=float)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    star_file     = sys.argv[1]
    output_prefix = sys.argv[2] if len(sys.argv) > 2 else 'tm_analysis'
    # output_prefix may be an absolute path including the output folder

    setup_style()
    df   = load_star(star_file)
    col  = map_columns(df)
    df_v, arrs = prepare_arrays(df, col)

    print_summary(arrs)

    print("\nGenerating figures...")
    fig_score_landscape(arrs, output_prefix)
    fig_per_tomo(arrs, output_prefix)
    fig_spatial(arrs, output_prefix)
    fig_orientations(arrs, output_prefix)
    fig_neighbors(arrs, output_prefix)
    fig_geometry(arrs, output_prefix)
    fig_extraction_guide(arrs, output_prefix)
    fig_tomo_heatmap(arrs, output_prefix)

    # Write summary JSON for the quick stats bar in the app
    try:
        import json as _json
        summary = {
            "n_particles": int(len(arrs["snr"])),
            "n_tomos": int(len(set(arrs["tomo"]))),
            "median_snr": float(round(float(np.median(arrs["snr"])), 3)),
            "mean_snr": float(round(float(arrs["snr"].mean()), 3)),
            "pct_good": float(round(float((arrs["snr"] >= 10).mean() * 100), 1)),
            "suggested_cutoff": float(round(float(np.percentile(arrs["snr"], 25)), 2)),
            "lcc_median": float(round(float(np.median(arrs["lcc"])), 4)),
            "lcc_range": [float(round(float(arrs["lcc"].min()), 4)),
                          float(round(float(arrs["lcc"].max()), 4))],
        }
        with open(f"{output_prefix}_summary.json", "w") as f:
            _json.dump(summary, f, indent=2)
        print(f"  Summary JSON: {output_prefix}_summary.json")
    except Exception as e:
        print(f"  (Summary JSON skipped: {e})")

    print(f"\nAll figures saved with prefix: {output_prefix}_*")
    print("Done!\n")


if __name__ == '__main__':
    main()