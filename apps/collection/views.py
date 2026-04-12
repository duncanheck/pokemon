import csv
import io
import logging
from decimal import Decimal

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Sum, Count, Q
from django.http import HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import EditCollectionItemForm
from .models import CollectionItem

logger = logging.getLogger(__name__)


def _portfolio_value(user) -> Decimal:
    """Sum market_price * quantity for all non-hunted items with known prices."""
    items = (
        CollectionItem.objects
        .filter(user=user, is_hunted=False)
        .select_related("card")
    )
    total = Decimal("0.00")
    for item in items:
        price = item.card.foil_price if item.is_foil else item.card.market_price
        if price:
            total += price * item.quantity
    return total


@login_required
def collection_list(request):
    tab = request.GET.get("tab", "all")

    base_qs = (
        CollectionItem.objects
        .filter(user=request.user)
        .select_related("card")
        .order_by("-updated_at")
    )

    if tab == "for_sale":
        qs = base_qs.filter(for_sale=True, is_hunted=False)
    elif tab == "want":
        qs = base_qs.filter(is_hunted=True)
    else:
        qs = base_qs.filter(is_hunted=False)

    counts = CollectionItem.objects.filter(user=request.user).aggregate(
        all=Count("id", filter=Q(is_hunted=False)),
        for_sale=Count("id", filter=Q(for_sale=True, is_hunted=False)),
        want=Count("id", filter=Q(is_hunted=True)),
    )

    edit_forms = {item.pk: EditCollectionItemForm(instance=item) for item in qs}

    context = {
        "items":           qs,
        "edit_forms":      edit_forms,
        "tab":             tab,
        "counts":          counts,
        "portfolio_value": _portfolio_value(request.user),
    }
    return render(request, "collection/list.html", context)


@login_required
@require_POST
def collection_update(request, pk):
    item = get_object_or_404(CollectionItem, pk=pk)
    if item.user != request.user:
        return HttpResponseForbidden()

    form = EditCollectionItemForm(request.POST, instance=item)
    if form.is_valid():
        form.save()
        messages.success(request, f"{item.card.name} updated.")
    else:
        messages.error(request, "Invalid data — please check the form.")

    return redirect(f"{request.META.get('HTTP_REFERER', '/collection/')}#{pk}")


@login_required
@require_POST
def collection_delete(request, pk):
    item = get_object_or_404(CollectionItem, pk=pk)
    if item.user != request.user:
        return HttpResponseForbidden()

    card_name = item.card.name
    item.delete()
    messages.success(request, f"{card_name} removed from your collection.")
    return redirect("collection_list")


@login_required
@require_POST
def collection_toggle(request, pk):
    item = get_object_or_404(CollectionItem, pk=pk)
    if item.user != request.user:
        return HttpResponseForbidden()

    field = request.POST.get("field")
    if field in ("for_sale", "is_hunted"):
        setattr(item, field, not getattr(item, field))
        item.save(update_fields=[field, "updated_at"])

    return redirect(request.META.get("HTTP_REFERER", "/collection/"))


@login_required
def collection_import(request):
    """
    Bulk-import cards from a CSV file.

    Expected columns (header row required):
      name, set, condition, qty, purchase_price, foil
    Only 'name' is mandatory; everything else is optional/defaulted.
    Cards are matched against the local DB by name + set.
    """
    if request.method != "POST":
        return render(request, "collection/import.html", {})

    csv_file = request.FILES.get("csv_file")
    if not csv_file:
        messages.error(request, "Please upload a CSV file.")
        return render(request, "collection/import.html", {})

    if not csv_file.name.lower().endswith(".csv"):
        messages.error(request, "File must have a .csv extension.")
        return render(request, "collection/import.html", {})

    try:
        decoded = csv_file.read().decode("utf-8-sig")  # handles Excel BOM
        reader  = csv.DictReader(io.StringIO(decoded))
        headers = {h.strip().lower() for h in (reader.fieldnames or [])}

        if "name" not in headers:
            messages.error(request, 'CSV must have at least a "name" column.')
            return render(request, "collection/import.html", {})

        from apps.cards.models import Card

        added = skipped = errors = 0
        for raw in reader:
            row = {k.strip().lower(): (v or "").strip() for k, v in raw.items()}
            try:
                name     = row.get("name", "")
                set_name = row.get("set", "")
                cond     = row.get("condition", "NM").upper()[:3]
                qty      = max(1, int(row.get("qty", row.get("quantity", 1)) or 1))
                price    = row.get("purchase_price") or None
                is_foil  = row.get("foil", "").lower() in ("1", "yes", "true", "foil")

                if not name:
                    skipped += 1
                    continue

                if cond not in dict(CollectionItem.CONDITION_CHOICES):
                    cond = "NM"

                # Match card in local DB — name exact or partial, set optional
                qs = Card.objects.filter(name__icontains=name)
                if set_name:
                    qs = qs.filter(set_name__icontains=set_name)
                card = qs.first()

                if card is None:
                    logger.debug("CSV import: no local card found for '%s' / '%s'", name, set_name)
                    skipped += 1
                    continue

                item, created = CollectionItem.objects.get_or_create(
                    user=request.user,
                    card=card,
                    condition=cond,
                    is_foil=is_foil,
                    defaults={"quantity": qty, "purchase_price": price},
                )
                if not created:
                    item.quantity += qty
                    item.save(update_fields=["quantity", "updated_at"])
                added += 1

            except Exception as exc:
                logger.warning("CSV import row error: %s — %s", row, exc)
                errors += 1

        messages.success(
            request,
            f"Import complete — {added} added, {skipped} skipped (not in DB), {errors} errors.",
        )
        return redirect("collection_list")

    except Exception as exc:
        messages.error(request, f"Could not parse CSV: {exc}")
        return render(request, "collection/import.html", {})
