using System;
using System.Threading.Tasks;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Lot 6 : port pur de arrow-navigation.ts (parité v9.1.6) + contrat du verrou
/// mono-instance (parité app.requestSingleInstanceLock d'electron/main.ts).
/// </summary>
public class FlèchesHubTests
{
    [Theory]
    [InlineData("ArrowDown", 0, 3, 1)]   // avance
    [InlineData("ArrowDown", 2, 3, 0)]   // bouclage bas → premier
    [InlineData("ArrowUp", 0, 3, 2)]     // bouclage haut → dernier
    [InlineData("ArrowUp", 2, 3, 1)]     // recule
    [InlineData("Home", 2, 3, 0)]        // extrémité
    [InlineData("End", 0, 3, 2)]         // extrémité
    [InlineData("ArrowLeft", 1, 3, -1)]  // touche inconnue → inchangé (null)
    [InlineData("ArrowDown", -1, 3, 0)]  // rien de sélectionné → premier item
    [InlineData("ArrowUp", -1, 3, 2)]    // rien de sélectionné → dernier item
    public void Suivant_calcule_l_index_cible(string touche, int courant, int total, int attendu)
    {
        var résultat = FlèchesHub.Suivant(touche, courant, total);
        Assert.Equal(attendu < 0 ? (int?)null : attendu, résultat);
    }

    [Fact]
    public void Suivant_sur_liste_vide_ne_déplace_pas()
    {
        Assert.Null(FlèchesHub.Suivant("ArrowDown", 0, 0));
        Assert.Null(FlèchesHub.Suivant("Home", 0, 0));
    }

    [Fact]
    public void Suivant_sur_liste_d_un_seul_item_reste_sur_lui()
    {
        Assert.Equal(0, FlèchesHub.Suivant("ArrowDown", 0, 1));
        Assert.Equal(0, FlèchesHub.Suivant("ArrowUp", 0, 1));
        Assert.Equal(0, FlèchesHub.Suivant("End", 0, 1));
    }
}

/// <summary>Contrat du verrou mono-instance : un seul propriétaire à la fois, la
/// libération rend le verrou disponible (pas de mutex fantôme après crash). L'état
/// statique partagé impose un séquencement — chaque scénario tourne isolément.</summary>
public class InstanceUniqueTests : IDisposable
{
    public void Dispose() => InstanceUnique.Libérer();

    [Fact]
    public void Premier_arrivé_propriétaire_second_refusé_puis_réveil_best_effort()
    {
        Assert.True(InstanceUnique.Acquérir());
        try
        {
            // La deuxième instance (même process, mêmes noms « Local\ ») est refusée…
            var verrou2 = new Mutex(initiallyOwned: true, InstanceUnique.NomMutex, out var créé);
            Assert.False(créé); // déjà possédé ailleurs
            if (créé) verrou2.ReleaseMutex();
            verrou2.Dispose();

            // …et son réveil est best effort : false tant que la première n'a pas
            // préparé son événement, true ensuite.
            Assert.False(InstanceUnique.RéveillerPremière());
            InstanceUnique.PréparerÉvénement();
            Assert.True(InstanceUnique.RéveillerPremière());
        }
        finally { InstanceUnique.Libérer(); }
    }

    [Fact]
    public async Task Libérer_rend_le_verrou_immédiatement()
    {
        Assert.True(InstanceUnique.Acquérir());
        InstanceUnique.PréparerÉvénement();
        InstanceUnique.Libérer();
        await Task.Yield(); // laisser retomber d'éventuels handles en vol

        var verrou = new Mutex(initiallyOwned: true, InstanceUnique.NomMutex, out var créé);
        Assert.True(créé); // le mutex fantôme n'existe plus
        if (créé) verrou.ReleaseMutex();
        verrou.Dispose();

        // Contrat complet Acquérir → Libérer → Acquérir : une relance juste après
        // une sortie propre redevient immédiatement la première instance.
        Assert.True(InstanceUnique.Acquérir());
    }

    [Fact]
    public void Libérer_double_est_sans_effet()
    {
        Assert.True(InstanceUnique.Acquérir());
        InstanceUnique.Libérer();
        InstanceUnique.Libérer(); // jamais d'exception (mutex/event déjà nuls)
        Assert.Null(InstanceUnique.ÉvénementRéveil);
    }
}
