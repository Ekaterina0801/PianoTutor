from __future__ import annotations
import torch
import torch.nn as nn
import math

class TCNBlock(nn.Module):
    def __init__(self, ch: int, k: int, dil: int, dropout: float = 0.1):
        super().__init__()
        pad = (k - 1) * dil // 2
        self.net = nn.Sequential(
            nn.Conv1d(ch, ch, k, padding=pad, dilation=dil),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Conv1d(ch, ch, 1),
            nn.GELU(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.net(x)

class PianoRollCorrector(nn.Module):
    """Tiny post-corrector for piano-roll."""
    def __init__(self, channels: int, layers: int = 6, k: int = 5):
        super().__init__()
        self.inp = nn.Conv1d(channels, channels, 1)
        blocks = []
        for i in range(layers):
            blocks.append(TCNBlock(channels, k=k, dil=2**i, dropout=0.1))
        self.blocks = nn.Sequential(*blocks)
        self.out = nn.Conv1d(channels, channels, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.inp(x)
        x = self.blocks(x)
        return self.out(x)

class PianoRollBiLSTMCorrector(nn.Module):
    """Bidirectional recurrent wrapper for piano-roll post-correction."""
    def __init__(self, channels: int, hidden: int = 96, layers: int = 2, dropout: float = 0.1):
        super().__init__()
        self.input = nn.Linear(channels, hidden)
        self.rnn = nn.LSTM(
            input_size=hidden,
            hidden_size=hidden,
            num_layers=layers,
            dropout=dropout if layers > 1 else 0.0,
            bidirectional=True,
            batch_first=True,
        )
        self.output = nn.Sequential(
            nn.LayerNorm(hidden * 2),
            nn.Linear(hidden * 2, channels),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        z = x.transpose(1, 2)
        z = self.input(z)
        z, _ = self.rnn(z)
        return self.output(z).transpose(1, 2)

class SinusoidalPosition(nn.Module):
    def __init__(self, d_model: int, max_len: int = 4096):
        super().__init__()
        pos = torch.arange(max_len, dtype=torch.float32).unsqueeze(1)
        div = torch.exp(torch.arange(0, d_model, 2, dtype=torch.float32) * (-math.log(10000.0) / d_model))
        pe = torch.zeros(max_len, d_model, dtype=torch.float32)
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer("pe", pe.unsqueeze(0), persistent=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, : x.shape[1], :]

class PianoRollTransformerCorrector(nn.Module):
    """Small Transformer encoder wrapper for piano-roll post-correction."""
    def __init__(self, channels: int, d_model: int = 128, heads: int = 4, layers: int = 2, dropout: float = 0.1):
        super().__init__()
        self.input = nn.Linear(channels, d_model)
        self.pos = SinusoidalPosition(d_model=d_model)
        layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=heads,
            dim_feedforward=d_model * 3,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=layers)
        self.output = nn.Linear(d_model, channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        z = x.transpose(1, 2)
        z = self.pos(self.input(z))
        z = self.encoder(z)
        return self.output(z).transpose(1, 2)

def build_corrector_model(architecture: str, channels: int = 88 * 3) -> nn.Module:
    arch = architecture.lower().strip()
    if arch == "tcn":
        return PianoRollCorrector(channels=channels, layers=6, k=5)
    if arch in {"bilstm", "lstm"}:
        return PianoRollBiLSTMCorrector(channels=channels)
    if arch in {"transformer", "neural_transformer"}:
        return PianoRollTransformerCorrector(channels=channels)
    raise ValueError(f"Unknown corrector architecture: {architecture}")
