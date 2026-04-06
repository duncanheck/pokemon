from decimal import Decimal

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Sum, Count, Q
from django.http import HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import EditCollectionItemForm
from .models import CollectionItem


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
    tab = request.GET.get("tab", "all")  # all | for_sale | want

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

    # Summary counts for tab badges
    counts = CollectionItem.objects.filter(user=request.user).aggregate(
        all=Count("id", filter=Q(is_hunted=False)),
        for_sale=Count("id", filter=Q(for_sale=True, is_hunted=False)),
        want=Count("id", filter=Q(is_hunted=True)),
    )

    # Inline edit form (per-item forms rendered in template)
    edit_forms = {item.pk: EditCollectionItemForm(instance=item) for item in qs}

    context = {
        "items": qs,
        "edit_forms": edit_forms,
        "tab": tab,
        "counts": counts,
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
    """Quick-toggle for_sale or is_hunted via small buttons in the table."""
    item = get_object_or_404(CollectionItem, pk=pk)
    if item.user != request.user:
        return HttpResponseForbidden()

    field = request.POST.get("field")
    if field in ("for_sale", "is_hunted"):
        current = getattr(item, field)
        setattr(item, field, not current)
        item.save(update_fields=[field, "updated_at"])

    return redirect(request.META.get("HTTP_REFERER", "/collection/"))
