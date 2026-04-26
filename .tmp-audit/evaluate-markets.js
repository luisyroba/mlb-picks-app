"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateSpecificMarketLineWithDistribution = evaluateSpecificMarketLineWithDistribution;
exports.evaluateSpecificMarketLine = evaluateSpecificMarketLine;
exports.evaluateMarkets = evaluateMarkets;
const probability_model_1 = require("./probability-model");
const weights_1 = require("./weights");
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function getMarketReliability(market, selection) {
    if (market === 'ML')
        return 1;
    if (market === 'RL')
        return 0.97;
    if (market === 'TOTAL')
        return 0.95;
    return /(^|\s)(over|under)(\s|$)/i.test(selection) ? 0.94 : 0.96;
}
function getConfidenceScore(confidence) {
    if (confidence === 'A')
        return 1;
    if (confidence === 'B')
        return 0.78;
    return 0.56;
}
function getSelectionScore(candidate) {
    const probabilityBaseline = Math.max(0.45, candidate.impliedProbability);
    const probabilitySpan = Math.max(0.08, 0.9 - probabilityBaseline);
    const probabilityScore = clamp((candidate.estimatedProbability - probabilityBaseline) / probabilitySpan, 0, 1);
    const edgeScore = clamp(candidate.edge / 0.22, 0, 1);
    const evScore = clamp(candidate.ev / 0.38, 0, 1);
    const confidenceScore = getConfidenceScore(candidate.confidence === 'PASS' ? 'C' : candidate.confidence);
    const marketReliability = getMarketReliability(candidate.market, candidate.selection);
    return Number(((evScore * 0.36 +
        edgeScore * 0.32 +
        probabilityScore * 0.2 +
        confidenceScore * 0.12) *
        100 *
        marketReliability).toFixed(3));
}
function buildEvaluation(market, selection, odds, estimatedProbability, reason, line) {
    const implied = (0, probability_model_1.impliedProbability)(odds);
    const edge = estimatedProbability - implied;
    const ev = (0, probability_model_1.expectedValue)(estimatedProbability, odds);
    let confidence = 'C';
    if (edge >= 0.1 && ev >= 0.04 && odds <= 2.1) {
        confidence = 'A';
    }
    else if (edge >= 0.06 && ev >= 0.015) {
        confidence = 'B';
    }
    const evaluation = {
        market,
        selection,
        line,
        odds,
        estimatedProbability,
        impliedProbability: implied,
        edge,
        ev,
        confidence,
        reason
    };
    return {
        ...evaluation,
        selectionScore: getSelectionScore(evaluation)
    };
}
function formatSignedLine(line) {
    return `${line > 0 ? '+' : ''}${line.toFixed(1)}`;
}
function describeProbability(probability) {
    return `${(probability * 100).toFixed(1)}%`;
}
function evaluateML(game, _layerA, distribution) {
    const odds = game.odds;
    if (!odds)
        return [];
    const margin = distribution.marginMean;
    const evaluations = [];
    if (odds.homeML) {
        const prob = (0, probability_model_1.probabilityMoneyline)(distribution, 'home');
        evaluations.push(buildEvaluation('ML', game.homeTeam.core.teamName, odds.homeML, prob, `Margen esperado ${margin.toFixed(2)} carreras para ${game.homeTeam.core.teamName}. Precio justo ${(0, probability_model_1.fairOdds)(prob).toFixed(2)} vs cuota ${odds.homeML.toFixed(2)}`));
    }
    if (odds.awayML) {
        const prob = (0, probability_model_1.probabilityMoneyline)(distribution, 'away');
        evaluations.push(buildEvaluation('ML', game.awayTeam.core.teamName, odds.awayML, prob, `Margen esperado ${Math.abs(margin).toFixed(2)} carreras para ${game.awayTeam.core.teamName}. Precio justo ${(0, probability_model_1.fairOdds)(prob).toFixed(2)} vs cuota ${odds.awayML.toFixed(2)}`));
    }
    return evaluations;
}
function evaluateRL(game, layerA, distribution) {
    const odds = game.odds;
    if (!odds)
        return [];
    const margin = distribution.marginMean;
    const starterEdge = Math.abs(layerA.blockScores.starter);
    const bullpenAdvantage = Math.abs(layerA.blockScores.bullpen);
    if (Math.abs(margin) < 0.72 || starterEdge < 14 || bullpenAdvantage < 6) {
        return [];
    }
    if (margin > 0 && odds.homeRL?.line !== undefined) {
        const prob = (0, probability_model_1.probabilityRunLine)(distribution, 'home', odds.homeRL.line);
        return [
            buildEvaluation('RL', `${game.homeTeam.core.teamName} ${odds.homeRL.line}`, odds.homeRL.odds, prob, `Margen esperado ${margin.toFixed(2)} local contra linea ${odds.homeRL.line}. Cobertura modelada ${describeProbability(prob)}`, odds.homeRL.line)
        ];
    }
    if (margin < 0 && odds.awayRL?.line !== undefined) {
        const prob = (0, probability_model_1.probabilityRunLine)(distribution, 'away', odds.awayRL.line);
        return [
            buildEvaluation('RL', `${game.awayTeam.core.teamName} ${odds.awayRL.line}`, odds.awayRL.odds, prob, `Margen esperado ${Math.abs(margin).toFixed(2)} visitante contra linea ${odds.awayRL.line}. Cobertura modelada ${describeProbability(prob)}`, odds.awayRL.line)
        ];
    }
    return [];
}
function evaluateF5Side(game, layerA, distribution) {
    const odds = game.odds;
    if (!odds || !layerA.gameScript.f5Viable)
        return [];
    const f5Margin = distribution.f5MarginMean;
    const starterScore = Math.abs(layerA.blockScores.starter);
    if (Math.abs(f5Margin) < 0.18 || starterScore < weights_1.SCORING_THRESHOLDS.f5StarterEdgeMin) {
        return [];
    }
    if (f5Margin > 0 && odds.homeF5ML) {
        const prob = (0, probability_model_1.probabilityMoneyline)(distribution, 'home', 'f5');
        return [
            buildEvaluation('F5', `${game.homeTeam.core.teamName} F5`, odds.homeF5ML, prob, `Margen esperado F5 ${f5Margin.toFixed(2)} local por ventaja de abridor. Precio justo ${(0, probability_model_1.fairOdds)(prob).toFixed(2)}`)
        ];
    }
    if (f5Margin < 0 && odds.awayF5ML) {
        const prob = (0, probability_model_1.probabilityMoneyline)(distribution, 'away', 'f5');
        return [
            buildEvaluation('F5', `${game.awayTeam.core.teamName} F5`, odds.awayF5ML, prob, `Margen esperado F5 ${Math.abs(f5Margin).toFixed(2)} visitante por ventaja de abridor. Precio justo ${(0, probability_model_1.fairOdds)(prob).toFixed(2)}`)
        ];
    }
    return [];
}
function evaluateF5Total(game, layerA, distribution) {
    const odds = game.odds?.f5Total;
    if (!odds || !layerA.gameScript.f5Viable)
        return [];
    const mean = distribution.f5TotalMean;
    const delta = mean - odds.line;
    if (Math.abs(delta) < 0.24) {
        return [];
    }
    if (delta > 0) {
        const prob = (0, probability_model_1.probabilityTotal)(distribution, 'over', odds.line, 'f5');
        return [
            buildEvaluation('F5', `F5 Over ${odds.line}`, odds.overOdds, prob, `Total F5 esperado ${mean.toFixed(2)} vs linea ${odds.line}. Over modelado ${describeProbability(prob)}`, odds.line)
        ];
    }
    const prob = (0, probability_model_1.probabilityTotal)(distribution, 'under', odds.line, 'f5');
    return [
        buildEvaluation('F5', `F5 Under ${odds.line}`, odds.underOdds, prob, `Total F5 esperado ${mean.toFixed(2)} vs linea ${odds.line}. Under modelado ${describeProbability(prob)}`, odds.line)
    ];
}
function evaluateTotal(game, layerA, distribution) {
    const odds = game.odds?.total;
    if (!odds)
        return [];
    const mean = distribution.totalMean;
    const delta = mean - odds.line;
    const minDelta = layerA.gameScript.scoringProjection === 'medium' ? 0.26 : 0.18;
    if (Math.abs(delta) < minDelta) {
        return [];
    }
    if (delta > 0) {
        const prob = (0, probability_model_1.probabilityTotal)(distribution, 'over', odds.line);
        return [
            buildEvaluation('TOTAL', `Over ${odds.line}`, odds.overOdds, prob, `Total esperado ${mean.toFixed(2)} vs linea ${odds.line}. Over modelado ${describeProbability(prob)}`, odds.line)
        ];
    }
    const prob = (0, probability_model_1.probabilityTotal)(distribution, 'under', odds.line);
    return [
        buildEvaluation('TOTAL', `Under ${odds.line}`, odds.underOdds, prob, `Total esperado ${mean.toFixed(2)} vs linea ${odds.line}. Under modelado ${describeProbability(prob)}`, odds.line)
    ];
}
function evaluateSpecificMarketLineWithDistribution(_game, distribution, line) {
    if (line.marketType === 'ML') {
        if (line.side !== 'home' && line.side !== 'away')
            return null;
        const prob = (0, probability_model_1.probabilityMoneyline)(distribution, line.side);
        const margin = line.side === 'home' ? distribution.marginMean : -distribution.marginMean;
        return buildEvaluation('ML', line.selection, line.odds, prob, `Margen esperado ${Math.abs(margin).toFixed(2)} para ${line.selection}. Precio justo ${(0, probability_model_1.fairOdds)(prob).toFixed(2)} vs cuota ${line.odds.toFixed(2)}`);
    }
    if (line.marketType === 'RL') {
        if ((line.side !== 'home' && line.side !== 'away') || line.line === undefined) {
            return null;
        }
        const prob = (0, probability_model_1.probabilityRunLine)(distribution, line.side, line.line);
        const margin = line.side === 'home' ? distribution.marginMean : -distribution.marginMean;
        return buildEvaluation('RL', `${line.selection} ${formatSignedLine(line.line)}`, line.odds, prob, `Margen esperado ${Math.abs(margin).toFixed(2)} para ${line.selection} contra ${formatSignedLine(line.line)}. Cobertura modelada ${describeProbability(prob)}`, line.line);
    }
    if (line.marketType === 'TOTAL') {
        if ((line.side !== 'over' && line.side !== 'under') || line.line === undefined) {
            return null;
        }
        const prob = (0, probability_model_1.probabilityTotal)(distribution, line.side, line.line);
        return buildEvaluation('TOTAL', `${line.side === 'over' ? 'Over' : 'Under'} ${line.line}`, line.odds, prob, `Total esperado ${distribution.totalMean.toFixed(2)} vs linea ${line.line}. ${line.side === 'over' ? 'Over' : 'Under'} modelado ${describeProbability(prob)}`, line.line);
    }
    if (line.marketType === 'F5') {
        if ((line.side === 'over' || line.side === 'under') && line.line !== undefined) {
            const prob = (0, probability_model_1.probabilityTotal)(distribution, line.side, line.line, 'f5');
            return buildEvaluation('F5', `F5 ${line.side === 'over' ? 'Over' : 'Under'} ${line.line}`, line.odds, prob, `Total F5 esperado ${distribution.f5TotalMean.toFixed(2)} vs linea ${line.line}. ${line.side === 'over' ? 'Over' : 'Under'} modelado ${describeProbability(prob)}`, line.line);
        }
        if (line.side !== 'home' && line.side !== 'away') {
            return null;
        }
        if (line.line === undefined) {
            const prob = (0, probability_model_1.probabilityMoneyline)(distribution, line.side, 'f5');
            const margin = line.side === 'home' ? distribution.f5MarginMean : -distribution.f5MarginMean;
            return buildEvaluation('F5', `${line.selection} F5`, line.odds, prob, `Margen esperado F5 ${Math.abs(margin).toFixed(2)} para ${line.selection}. Precio justo ${(0, probability_model_1.fairOdds)(prob).toFixed(2)} vs cuota ${line.odds.toFixed(2)}`);
        }
        const prob = (0, probability_model_1.probabilityRunLine)(distribution, line.side, line.line, 'f5');
        const margin = line.side === 'home' ? distribution.f5MarginMean : -distribution.f5MarginMean;
        return buildEvaluation('F5', `${line.selection} F5 ${formatSignedLine(line.line)}`, line.odds, prob, `Margen F5 esperado ${Math.abs(margin).toFixed(2)} para ${line.selection} contra ${formatSignedLine(line.line)}. Cobertura modelada ${describeProbability(prob)}`, line.line);
    }
    return null;
}
function evaluateSpecificMarketLine(game, layerA, line) {
    const distribution = (0, probability_model_1.buildGameDistribution)(game, layerA);
    return evaluateSpecificMarketLineWithDistribution(game, distribution, line);
}
function evaluateMarkets(game, layerA) {
    const distribution = (0, probability_model_1.buildGameDistribution)(game, layerA);
    const candidates = [
        ...evaluateML(game, layerA, distribution),
        ...evaluateRL(game, layerA, distribution),
        ...evaluateF5Side(game, layerA, distribution),
        ...evaluateF5Total(game, layerA, distribution),
        ...evaluateTotal(game, layerA, distribution)
    ];
    return candidates
        .filter((candidate) => candidate.edge > 0 && candidate.ev > 0)
        .sort((left, right) => {
        const scoreGap = (right.selectionScore ?? right.ev) - (left.selectionScore ?? left.ev);
        if (scoreGap !== 0) {
            return scoreGap;
        }
        if (right.edge !== left.edge) {
            return right.edge - left.edge;
        }
        if (right.ev !== left.ev) {
            return right.ev - left.ev;
        }
        return right.estimatedProbability - left.estimatedProbability;
    });
}
